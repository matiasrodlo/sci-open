import {
  isHttpUrl,
  type AuthorityFacts, type FieldSources, type FullText,
  type Paper, type ProvenancedField
} from '@sci-open/shared';
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
  /** The caller's: aborting it ends the step as the budget does. */
  signal?: AbortSignal;
};

export type EnrichResult = {
  papers: Paper[];
  /**
   * True when the budget ran out with a question still unanswered: some lookup
   * was put and had not come back, with an answer or a failure, when it
   * expired. The rescue reads it — a question that might have kept a paper
   * went unasked, so the set is bounded — and so does nothing else.
   */
  cutShort: boolean;
  /**
   * How many of the papers handed in got a usable answer — a lookup came back
   * for them, in time, saying something the caller can act on. A null counts:
   * "this authority knows nothing about that DOI" settles the question. A
   * failed lookup and one the budget never reached do not, because both leave
   * the paper exactly as unjudged as never asking would have.
   *
   * Every lookup put for the paper has to have answered, not just one. With a
   * single authority those are the same thing; with two they are not — the
   * rescue asks Unpaywall and the preprint servers together, and a paper
   * Unpaywall answered null for while its server timed out has had half its
   * question answered. Counted as examined, the rescue reported itself
   * complete with a paper dropped that one more second would have kept.
   *
   * A count of lookups cannot answer this: it double-counts a paper two
   * authorities both looked up and over-counts one whose lookup was abandoned
   * mid-flight. This counts distinct papers, so `handed in − examined` is the
   * shortfall and nothing else.
   *
   * The page path ignores it — enrichment there is optional detail, and a paper
   * nobody reached is still returned. The rescue is the caller that needs it,
   * because there a paper nobody reached is a paper silently dropped.
   */
  examined: number;
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

    // The same scheme check the providers' URLs get, at the one place every
    // authority's facts pass through. The normalisers already apply it, so this
    // is the backstop rather than the rule: an authority added later cannot
    // skip it, and no route exists by which `fullText` becomes a
    // `javascript:` URL after the providers have been screened. See
    // `shared/url.ts`.
    if (field === 'landingPage' && !isHttpUrl(value)) continue;
    if (field === 'fullText' && !isHttpUrl((value as FullText)?.url)) continue;

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
    cache,
    signal
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
    return { papers: enriched, examined: 0, cutShort: false };
  }

  const controller = new AbortController();
  const expiry = setTimeout(() => controller.abort(), budgetMs);
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel, { once: true });

  /**
   * Lookups put for each paper, and how many of them came back, by id. A paper
   * is examined when the two agree — see `EnrichResult.examined`. Counted when
   * a task is queued rather than when it starts, so one the budget never
   * reached is a question put and not answered.
   */
  const put = new Map<string, number>();
  const answeredFor = new Map<string, number>();

  /**
   * Lookups started, and lookups that concluded — with facts, with a null, or
   * with a failure. Kept apart from `answeredFor`, which asks whether a
   * *paper* was judged: a failure is a conclusion for the lookup and no
   * judgement of the paper.
   */
  let asked = 0;
  let settled = 0;

  try {
    for (const pass of [0, 1] as const) {
      const running = authorities.filter(a => a.pass === pass);
      if (running.length === 0 || controller.signal.aborted) continue;

      // Paper by paper, every authority's question about it together, in the
      // order the papers came — which for the rescue is rank order. Queued
      // authority by authority, the second one's questions waited behind all
      // of the first one's, and on two hundred candidates a budget spent on
      // Unpaywall left the preprint servers none; a paper is only examined
      // once all its questions are answered, so the budget is better spent
      // finishing the best-ranked papers than half-asking every one.
      const tasks: Array<() => Promise<void>> = [];
      for (const paper of withDoi) {
        for (const authority of running) {
          if (authority.wants && !authority.wants(paper)) continue;
          put.set(paper.id, (put.get(paper.id) ?? 0) + 1);
          tasks.push(async () => {
            asked += 1;
            try {
              const lookup = () => authority.lookup({
                doi: paper.doi!,
                timeoutMs: authority.timeoutMs ?? timeoutMs,
                signal: controller.signal,
                ...(userAgent ? { userAgent } : {})
              });
              const facts = cache
                ? await cache.fetch(authority.id, paper.doi!, lookup)
                : await lookup();
              // The page may already have been returned; see `untilBudget`. A
              // lookup that lands after the budget is discarded, so the paper
              // it was about was not examined — nothing it said can count.
              if (controller.signal.aborted) return;

              // Answered, including a null: "this authority knows nothing about
              // that DOI" is an answer, and the paper had its chance.
              answeredFor.set(paper.id, (answeredFor.get(paper.id) ?? 0) + 1);
              settled += 1;

              if (facts) applyFacts(paper, facts, authority);
            } catch {
              // Deliberately *not* examined. The question was put and came back
              // with nothing usable, so this paper is as unjudged as one the
              // budget never reached — and `candidates - examined` is only the
              // shortfall it claims to be if a failed lookup counts as a gap.
              //
              // Settled all the same: the lookup concluded. Guarded on the
              // signal for the same reason the success path is — a lookup that
              // threw *because* the budget aborted it was cut off rather than
              // concluded, and counting it would let a late `AbortError` erase
              // the very cut that caused it.
              if (!controller.signal.aborted) settled += 1;
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
    signal?.removeEventListener('abort', cancel);
  }

  // A null is an answer: an authority that knows nothing about most of a page
  // — Unpaywall, by nature — has still finished with it. Only a question put
  // and not concluded when the budget expired leaves the page cut short.
  const cutShort = controller.signal.aborted && settled < asked;

  let examined = 0;
  for (const [id, count] of put) if (answeredFor.get(id) === count) examined += 1;

  return { papers: enriched, examined, cutShort };
}
