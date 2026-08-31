import type {
  AuthorityFacts, AuthorityReport, FieldSources, FullText, Paper, ProvenancedField
} from '@open-access-explorer/shared';
import { preferredPdfUrl, servesInterstitial } from '../lib/pdf-url';
import { AUTHORITIES, type AuthorityEntry } from '../authorities';
import type { AuthorityCache } from './authority-cache';

/**
 * Ask the authorities about the page that is being returned.
 *
 * **The page, not the set.** These are per-DOI lookups, one request each, so
 * the cost is linear in how many records they are pointed at: a measured
 * result set of 2,388 records would be 2,388 requests per authority, and the
 * twenty being returned are twenty. The previous rewrite lost cross-source
 * enrichment entirely rather than pay the first number; running it after
 * pagination is what makes it affordable at all.
 *
 * That used to have a cost this comment called unrecoverable. `applyPolicy`
 * runs before pagination and drops papers with no retrievable copy, so a paper
 * whose only PDF Unpaywall knows about was discarded before enrichment could
 * find it. `rescue.ts` closes that: the papers the gate would drop are asked
 * about first, bounded in number, and only the authorities that could change
 * the answer are asked. It is the same step as this one pointed at a different
 * set, and it shares this one's lookups through `AuthorityCache`.
 *
 * Enrichment never adds, removes or reorders papers. It fills in the ones
 * already chosen, so `total`, the facets and the page boundaries all continue
 * to describe the same set they described before it ran.
 */

export type EnrichOptions = {
  authorities?: readonly AuthorityEntry[];
  /** Per-lookup budget. */
  timeoutMs?: number;
  /** Wall clock for the whole step. Whatever has not finished is abandoned. */
  budgetMs?: number;
  /** Lookups in flight at once. */
  concurrency?: number;
  userAgent?: string;
  /**
   * Per-search memo of what each authority said about each DOI. Shared with
   * the rescue pass, which asks the same question of the same records one step
   * earlier — see `rescue.ts`.
   */
  cache?: AuthorityCache;
};

export type EnrichResult = {
  papers: Paper[];
  reports: AuthorityReport[];
};

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_BUDGET_MS = 6000;
const DEFAULT_CONCURRENCY = 8;

/** Same emptiness test the merge uses, so "missing" means one thing. */
function hasValue(paper: Paper, field: ProvenancedField): boolean {
  const value = (paper as any)[field];
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (field === 'oaStatus') return value !== 'unknown';
  return true;
}

/**
 * Whether a candidate copy is worth swapping in for the one we have.
 *
 * Authoritative does not mean unconditional. Two rules were tried and only one
 * survives, which is worth keeping visible because the one that failed is the
 * intuitive one.
 *
 * **Escaping a known gate stays.** A URL that answers a robot with a download
 * page instead of the file is not a copy, and the substitute is measured:
 * 13 / 13 of the PMC URLs seen on a page were fixed by the rewrite.
 *
 * **"A PDF beats a landing page" was removed.** It sounds obviously right and
 * it is a coin flip. Measured 2026-08-30 over five queries and a hundred
 * results, it produced 17 substitutions for **1 fixed and 1 regressed**, and
 * moved the page's download rate from 72% to 67%. The reason shows up in the
 * pairs it chose: `doaj.org` -> `sciencedirect.com`, `doi.org` ->
 * `onlinelibrary.wiley.com`, `pubmed.ncbi.nlm.nih.gov` -> `mdpi.com`. It was
 * trading resolver URLs, which redirect and mostly work, for direct publisher
 * URLs, which are the ones behind bot protection. And `kind` is not reliable
 * enough to bet on either way — the `doaj.org` URLs are marked `html` and
 * served real PDFs.
 *
 * So an incumbent is kept unless it is demonstrably not a copy at all. What
 * remains for an authority to do here is fill a gap, which matters whenever
 * `requireFullText` is off and the page can contain papers with no copy yet.
 */
export function betterFullText(current: FullText | undefined, candidate: FullText): boolean {
  if (!current) return true;
  // Something we confirmed beats something a provider claimed.
  if (current.verified && !candidate.verified) return false;
  return servesInterstitial(current.url) && !servesInterstitial(candidate.url);
}

/**
 * Writes one authority's facts onto a paper, recording who supplied what.
 *
 * Returns the number of fields actually written, which is the only number that
 * says whether the request was worth making.
 */
export function applyFacts(paper: Paper, facts: AuthorityFacts, authority: AuthorityEntry): number {
  const { fields, authoritative } = authority.capabilities;
  const fieldSources: FieldSources = { ...paper.fieldSources };
  let applied = 0;

  for (const field of fields) {
    const value = (facts as any)[field];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;

    // Topics are additive rather than chosen: two vocabularies describing the
    // same work both say something true. Same rule the merge uses.
    if (field === 'topics') {
      const incoming = (value as string[]).filter(t => !paper.topics.includes(t));
      if (incoming.length === 0) continue;
      paper.topics.push(...incoming);
      if (!fieldSources.topics) fieldSources.topics = authority.id;
      applied += 1;
      continue;
    }

    if (field === 'fullText') {
      // The authoritative check is not optional here just because there is a
      // better/worse test to apply. An authority that has not claimed the
      // field may fill a gap and nothing more — Crossref's PDF links are
      // `intended-application: text-mining`, which is a licence to mine rather
      // than a promise that the URL serves anyone who asks, and several of
      // them point at `api.wiley.com`, which wants a TDM token.
      if (paper.fullText && !authoritative.includes('fullText')) continue;
      if (!betterFullText(paper.fullText, value as FullText)) continue;
      paper.fullText = value as FullText;
      fieldSources.fullText = authority.id;
      applied += 1;
      continue;
    }

    const overwrites = authoritative.includes(field);
    if (hasValue(paper, field) && !overwrites) continue;
    if (overwrites && (paper as any)[field] === value) continue;

    (paper as any)[field] = value;
    fieldSources[field] = authority.id;
    applied += 1;
  }

  // `stage` is a fact about the work with no slot in `FieldSources`, so it is
  // filled without attribution and never overwrites a stage a provider stated.
  if (facts.stage && paper.stage === 'unknown') {
    paper.stage = facts.stage;
    applied += 1;
  }

  paper.fieldSources = fieldSources;
  return applied;
}

/** Runs tasks with a ceiling on how many are in flight, stopping when aborted. */
async function pooled(tasks: Array<() => Promise<void>>, limit: number, signal: AbortSignal): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length && !signal.aborted) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}

/**
 * Returns when the pool drains or when the budget expires, whichever is first.
 *
 * Aborting the signal is not enough on its own. `pooled` checks it between
 * tasks, so a lookup already in flight that does not honour the abort would
 * hold the page open for as long as it liked — and the budget exists precisely
 * because enrichment is optional and the page is already correct without it.
 * The abandoned lookups are left to settle on their own; `applyFacts` is
 * guarded on the same signal, so a late one cannot write into a paper that has
 * already been returned.
 */
function untilBudget(work: Promise<void>, signal: AbortSignal): Promise<void> {
  return Promise.race([
    work,
    new Promise<void>(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    })
  ]);
}

export async function enrichPage(
  papers: readonly Paper[],
  options: EnrichOptions = {}
): Promise<EnrichResult> {
  const {
    authorities = AUTHORITIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    budgetMs = DEFAULT_BUDGET_MS,
    concurrency = DEFAULT_CONCURRENCY,
    userAgent,
    cache
  } = options;

  // Copied rather than mutated in place: the caller's array may be the same
  // objects the provider cache is holding.
  const enriched: Paper[] = papers.map(paper => ({
    ...paper,
    topics: [...paper.topics],
    sources: [...paper.sources],
    fieldSources: { ...paper.fieldSources },
    // A URL known to serve a download gate rather than the file is rewritten
    // whatever produced it, and whether or not this paper has a DOI to enrich
    // by. See `lib/pdf-url.ts` — measured, it is thirteen of twenty pages.
    ...(paper.fullText && preferredPdfUrl(paper.fullText.url) !== paper.fullText.url
      ? { fullText: { ...paper.fullText, url: preferredPdfUrl(paper.fullText.url) } }
      : {})
  }));

  const withDoi = enriched.filter(paper => paper.doi);
  if (authorities.length === 0 || withDoi.length === 0) {
    return {
      papers: enriched,
      reports: authorities.map(authority => ({
        authority: authority.id,
        status: 'skipped' as const,
        asked: 0,
        answered: 0,
        applied: 0,
        skipReason: withDoi.length === 0 ? 'no paper on the page carries a DOI' : 'not consulted',
        latency: 0
      }))
    };
  }

  const controller = new AbortController();
  const expiry = setTimeout(() => controller.abort(), budgetMs);

  const tally = new Map<string, { asked: number; answered: number; applied: number; errors: number; error?: string; startedAt: number; latency: number }>();
  for (const authority of authorities) {
    tally.set(authority.id, { asked: 0, answered: 0, applied: 0, errors: 0, startedAt: Date.now(), latency: 0 });
  }

  try {
    for (const pass of [0, 1] as const) {
      const running = authorities.filter(a => a.pass === pass);
      if (running.length === 0 || controller.signal.aborted) continue;

      const tasks: Array<() => Promise<void>> = [];
      for (const authority of running) {
        for (const paper of withDoi) {
          if (authority.wants && !authority.wants(paper)) continue;
          tasks.push(async () => {
            const counters = tally.get(authority.id)!;
            counters.asked += 1;
            try {
              const lookup = () => authority.lookup({
                doi: paper.doi!,
                timeoutMs,
                signal: controller.signal,
                ...(userAgent ? { userAgent } : {})
              });
              const facts = cache
                ? await cache.fetch(authority.id, paper.doi!, lookup)
                : await lookup();
              // The page may already have been returned; see `untilBudget`.
              if (!facts || controller.signal.aborted) return;
              counters.answered += 1;
              counters.applied += applyFacts(paper, facts, authority);
            } catch (error) {
              counters.errors += 1;
              counters.error ??= error instanceof Error ? error.message : String(error);
            } finally {
              counters.latency = Date.now() - counters.startedAt;
            }
          });
        }
      }

      // The passes are sequential so a pass-1 authority sees what pass 0
      // filled in — that is the whole reason OpenCitations is in a second one.
      await untilBudget(pooled(tasks, concurrency, controller.signal), controller.signal);
    }
  } finally {
    clearTimeout(expiry);
  }

  const expired = controller.signal.aborted;

  const reports: AuthorityReport[] = authorities.map(authority => {
    const c = tally.get(authority.id)!;

    // A budget that ran out is a timeout for whoever had work left, and
    // nothing at all for an authority that had already finished.
    const status =
      c.asked === 0 ? 'skipped'
      : expired && c.answered + c.errors < c.asked ? 'timeout'
      : c.errors > 0 && c.answered === 0 ? 'error'
      : 'ok';

    return {
      authority: authority.id,
      status,
      asked: c.asked,
      answered: c.answered,
      applied: c.applied,
      ...(status === 'error' && c.error !== undefined ? { error: c.error } : {}),
      ...(status === 'timeout'
        ? { error: `exceeded the ${budgetMs}ms enrichment budget` }
        : {}),
      ...(c.asked === 0
        ? { skipReason: 'nothing on this page needed it' }
        : {}),
      latency: c.latency
    };
  });

  return { papers: enriched, reports };
}
