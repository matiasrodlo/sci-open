import type { PaperStage, SearchFilters, SearchParams, SearchResponse } from '@open-access-explorer/shared';
import { search as orchestratorSearch, DEFAULT_DEPTH, MAX_DEPTH } from './index';
import { parseQuery } from './parse-query';
import type { UserFilters } from './policy';
import type { ProviderCache } from './provider-cache';
import type { ProviderEntry } from './registry';
import type { AuthorityEntry } from '../authorities';
import { toSearchResponse } from './to-search-response';
import { DEFAULT_RESCUE_BUDGET_MS, DEFAULT_RESCUE_LIMIT } from './rescue';
import { log } from '../lib/logger';

/**
 * The request shape the API already accepts -> the orchestrator.
 *
 * The mirror of `to-search-response`. Between them the new path speaks the old
 * path's wire contract on both sides, which is what lets the flag switch
 * implementations without the frontend moving. The orchestrator itself speaks
 * `Query` and `Paper` and learns nothing about `SearchParams` — teaching it
 * would defeat the point of having built it.
 *
 * It lives here rather than in the route because the comparison script needs
 * the same conversion. A harness that reimplemented it would be measuring
 * something the service does not run.
 */

/**
 * The old path decided this from which connector returned a record —
 * `europepmc` and `ncbi` meant peer-reviewed, `arxiv` meant preprint — which
 * says where a record came from, not what it is. A `Paper` carries the version
 * it actually is, so the same question is answered from `stage`.
 */
const PUBLICATION_TYPE_STAGES: Record<string, PaperStage[]> = {
  'peer-reviewed': ['accepted', 'published'],
  preprint: ['preprint']
};

export function toUserFilters(filters: SearchFilters): UserFilters {
  const stage = (filters.publicationType ?? []).flatMap(type => PUBLICATION_TYPE_STAGES[type] ?? []);

  return {
    ...(filters.source !== undefined ? { source: filters.source } : {}),
    ...(filters.yearFrom !== undefined ? { yearFrom: filters.yearFrom } : {}),
    ...(filters.yearTo !== undefined ? { yearTo: filters.yearTo } : {}),
    ...(filters.year !== undefined ? { year: filters.year } : {}),
    ...(filters.oaStatus !== undefined ? { oaStatus: filters.oaStatus } : {}),
    ...(filters.venue !== undefined ? { venue: filters.venue } : {}),
    ...(filters.publisher !== undefined ? { publisher: filters.publisher } : {}),
    ...(filters.topics !== undefined ? { topics: filters.topics } : {}),
    ...(stage.length > 0 ? { stage } : {})
  };
}

/**
 * Warns about a misconfigured setting once per process rather than once per
 * search.
 *
 * A value that is out of range is out of range for every request, so warning
 * where it is read would put a line in the log for each one. Silence is the
 * other option and it is the worse one: an operator who sets `SEARCH_DEPTH`
 * past the ceiling would otherwise get the clamped depth with nothing anywhere
 * saying their number is not the one in effect — which is the same
 * self-concealing shape as a knob that has no effect at all.
 *
 * Keyed on the message, so a value that later changes is reported again.
 */
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  log.warn(message);
}

/**
 * How deep each provider is read.
 *
 * The setting that decides how much of a corpus a search sees, and the one
 * behind the header's "N retrieved of M+ matching": the retrieved figure is
 * `depth x providers that answered`, less duplicates and less what the gates
 * dropped, while the matching figure is the corpus those were drawn from.
 * Raising this is the only thing that closes the gap.
 *
 * **Raise `SEARCH_RESCUE_BUDGET_MS` alongside it.** Depth multiplies the
 * candidates the open-access gate would drop, and the rescue budget does not
 * grow to match, so depth on its own fetches more records and then drops a
 * larger fraction of them without asking. The search reports `bounded` either
 * way; the difference is that the extra requests bought less than they look
 * like they should have.
 *
 * `MAX_DEPTH` is the ceiling and the orchestrator applies it. This only warns,
 * because the clamp belongs where every caller passes and this is one of them.
 *
 * Non-positive and unparseable values fall back to the default, as the rescue
 * budget does and for the same reason: a depth of zero would plan the fan-out,
 * ask every provider, and read nothing back from any of them.
 */
function searchDepth(): number {
  const raw = process.env.SEARCH_DEPTH;
  const depth = Number(raw);
  if (!Number.isFinite(depth) || depth <= 0) return DEFAULT_DEPTH;

  if (depth > MAX_DEPTH) {
    warnOnce(`SEARCH_DEPTH=${raw} is above the ceiling of ${MAX_DEPTH}; reading ${MAX_DEPTH} deep instead`);
  }

  return depth;
}

/**
 * How many papers the policy gate may ask about before dropping them.
 *
 * Read here rather than in the orchestrator because this is the boundary where
 * a request becomes orchestrator options, and the orchestrator itself takes
 * the number as an argument like every other budget it owns.
 *
 * The cost is one request per candidate to each authority that is
 * authoritative on the gated fields — today that is Unpaywall alone, so one
 * request per candidate. Zero turns the step off and restores the behaviour
 * where a paper with no advertised copy is dropped without anyone being asked.
 */
function rescueLimit(): number {
  const raw = Number(process.env.SEARCH_RESCUE_LIMIT);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RESCUE_LIMIT;
}

/**
 * How long the whole rescue pass may take, and the setting that actually
 * decides how many candidates are reached.
 *
 * `SEARCH_RESCUE_LIMIT` was the only knob for a long time, and it is the wrong
 * one to reach for first: the two defaults cannot both bind, and on a broad
 * query it is always this budget that expires while the limit sits unreached.
 * An operator raising the limit to rescue more papers was changing a number
 * with no effect. See `DEFAULT_RESCUE_BUDGET_MS`.
 *
 * Zero is refused rather than honoured, which is the one place this parses
 * differently from the limit. A limit of zero is a coherent instruction — do
 * not run the step — and already has that meaning; a budget of zero would mean
 * "run the step, and abort it before the first lookup can return", which spends
 * the setup to guarantee nothing. Anyone who wants the step off wants
 * `SEARCH_RESCUE_LIMIT=0`.
 */
function rescueBudgetMs(): number {
  const raw = Number(process.env.SEARCH_RESCUE_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESCUE_BUDGET_MS;
}

export type RunOptions = {
  /** Shared across requests, which is the only way caching a fan-out pays. */
  cache?: ProviderCache;
  userAgent?: string;
  /** Defaults to the whole registry. A subset is how this is driven offline. */
  providers?: readonly ProviderEntry[];
  /** Likewise for the authorities. An empty list turns enrichment off. */
  authorities?: readonly AuthorityEntry[];
};

/**
 * `SearchParams` in, the same `SearchResponse` out.
 *
 * Two filters the old path declared but never read are honoured here.
 * `openAccessOnly` and `oaStatus` were both hard-filtered past — every search
 * returned open records whether or not it asked to — and `applyPolicy` exists
 * to make that a request option rather than a rule buried in a filter. The
 * defaults reproduce the old behaviour, so a request that does not mention
 * them is unaffected.
 */
export async function runOrchestrator(
  params: SearchParams,
  options: RunOptions = {}
): Promise<SearchResponse> {
  const filters = params.filters ?? {};
  const { yearFrom, yearTo } = filters;

  // The bounds go into the Query so a provider that can express a year filter
  // applies it upstream and spends its page budget on records in range. They
  // stay in the policy filter too: a provider that cannot express one still
  // returns records outside it, and `capabilities.yearFilter` is what says
  // which case a provider is in.
  const years = yearFrom !== undefined || yearTo !== undefined
    ? {
        ...(yearFrom !== undefined ? { from: yearFrom } : {}),
        ...(yearTo !== undefined ? { to: yearTo } : {})
      }
    : undefined;

  // `doi` wins over `q` when both are set: it is the more specific statement
  // of what the caller wants. The old path never read the field at all, so a
  // DOI only worked when it was typed into `q` — which `parseQuery` still
  // detects.
  const query = parseQuery(params.doi ?? params.q ?? '', { ...(years ? { years } : {}) });

  const openAccessOnly = filters.openAccessOnly ?? true;

  const result = await orchestratorSearch(query, {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    depth: searchDepth(),
    filters: toUserFilters(filters),
    sort: params.sort ?? 'relevance',
    openAccessOnly,
    policy: { requireOpenAccess: openAccessOnly },
    rescueLimit: rescueLimit(),
    rescueBudgetMs: rescueBudgetMs(),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.providers ? { providers: options.providers } : {}),
    ...(options.authorities ? { authorities: options.authorities } : {})
  });

  // The one step that changes which papers are in the result, and the only
  // one whose accounting the response shape has nowhere to put. Logged so a
  // bounded rescue — the case where `total` is still a lower bound — is
  // visible without waiting on a contract change. Debug, because it is one
  // line per uncached search and says nothing when there was nothing to ask.
  if (result.rescue.candidates > 0) {
    const { authorities: _asked, ...counts } = result.rescue;
    log.debug('Rescue pass', { query: params.q, ...counts });
  }

  return toSearchResponse(result, {
    // Echoed the way the old path echoed them, absent field included, so the
    // response is the same object to a client that cannot tell which path
    // produced it.
    ...(params.filters !== undefined ? { filters: params.filters } : {}),
    sort: params.sort ?? 'relevance'
  });
}
