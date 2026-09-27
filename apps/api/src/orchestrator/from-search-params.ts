import type { CountedFacet, PaperStage, Query, SearchFilters, SearchParams, SearchResponse, YearRange } from '@open-access-explorer/shared';
import { isStructured } from '@open-access-explorer/shared';
import type { FacetQueries } from './source-facets';
import { search as orchestratorSearch, DEFAULT_DEPTH } from './index';
import { parseQuery } from './parse-query';
import type { UserFilters } from './policy';
import type { ProviderCache } from './provider-cache';
import type { ResultSetCache } from './result-set';
import type { AuthorityFactsCache } from './authority-cache';
import type { UpstreamStats } from './upstream-stats';
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
 * Filters no source can be sent — applied to what the sources returned, and
 * nowhere else. A venue is a name, and there is no query every source would
 * read the same way for it; the source and route filters are this service's
 * own labels.
 */
const READ_ONLY_FILTERS = ['source', 'oaStatus', 'venue', 'publisher', 'topics'] as const;

/** The filter each countable facet's own checkboxes write, which its count lifts. */
const OWN_FILTER: Record<CountedFacet, keyof SearchFilters> = {
  year: 'year',
  stage: 'publicationType',
  venue: 'venue',
  publisher: 'publisher',
  topics: 'topics'
};

/** The years ticked in the year facet, as numbers, once each, oldest first. */
function tickedYears(filters: SearchFilters): number[] {
  const years = (filters.year ?? []).map(Number).filter(Number.isInteger);
  return [...new Set(years)].sort((a, b) => a - b);
}

/**
 * The ticked years as a bound the sources can be sent: from the first to the
 * last, inside `yearFrom`/`yearTo` when those are set too.
 *
 * Exact when the ticked years run without a gap, which one year always does.
 * With a gap it is wider than what was ticked, and the year filter the
 * pipeline applies to what comes back does the rest — the sources still spend
 * their read on the right decade, but their counts are of the whole span.
 */
function yearsToSend(bound: YearRange | undefined, ticked: readonly number[]): YearRange | undefined {
  if (ticked.length === 0) return bound;
  const from = Math.max(ticked[0]!, bound?.from ?? Number.NEGATIVE_INFINITY);
  const to = Math.min(ticked[ticked.length - 1]!, bound?.to ?? Number.POSITIVE_INFINITY);
  return { from, to };
}

/**
 * The settings that decide how much work a search does. Parsed and explained
 * in `config.ts`, where `SEARCH_DEPTH`, `SEARCH_RESCUE_LIMIT`,
 * `SEARCH_RESCUE_BUDGET_MS` and `SEARCH_FACET_COUNTS` are read; this only
 * applies them.
 */
export type SearchSettings = {
  /** How deep each provider is read. The orchestrator clamps it to `MAX_DEPTH`. */
  depth: number;
  /** How many papers the gate would drop may be asked about first. Zero turns the rescue off. */
  rescueLimit: number;
  /** Wall clock for the whole rescue pass. */
  rescueBudgetMs: number;
  /** Whether facets are counted across everything the sources hold, or only over the read. */
  facetCounts: boolean;
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  depth: DEFAULT_DEPTH,
  rescueLimit: DEFAULT_RESCUE_LIMIT,
  rescueBudgetMs: DEFAULT_RESCUE_BUDGET_MS,
  facetCounts: true
};

function gapless(years: readonly number[]): boolean {
  return years.length === 0 || years[years.length - 1]! - years[0]! + 1 === years.length;
}

/**
 * Which facets to count across everything the sources match, and whether the
 * sources' own counts describe this search — both decided by one question:
 * was everything that narrows it sent to them?
 *
 * The year and publication-type facets are sent (see `runOrchestrator`), so a
 * reader who ticks 2024 is shown how many papers from 2024 there are, not how
 * many were in the top of what was read. The rest are not, and a facet is only
 * counted across the sources when no *other* ticked filter is one of those:
 * ticking a venue leaves the venue facet counted across the sources — it is
 * counted with its own selection lifted — and every other facet counted from
 * the read, because no source's count of 2024 knows about the venue.
 *
 * A structured query is widened for the sources that cannot express it —
 * OpenAIRE is sent `crispr` for `AU=Doudna AND crispr` — so its counts are of a
 * larger question, and nothing is counted across the sources for one. The same
 * rule the web applies to the header's count, for the same reason.
 */
function sourceCounting(
  filters: SearchFilters,
  query: Query,
  ask: (years: YearRange | undefined, withStages: boolean) => Query,
  bound: YearRange | undefined,
  countAcrossSources: boolean
): { facetQueries?: FacetQueries; filtersSent: boolean } {
  if (query.doi || (query.expression && isStructured(query.expression))) return { filtersSent: false };

  const readOnly = READ_ONLY_FILTERS.filter(key => (filters[key]?.length ?? 0) > 0);
  const ticked = tickedYears(filters);
  const yearsExact = gapless(ticked);
  const filtersSent = readOnly.length === 0 && yearsExact;

  // The off switch, `SEARCH_FACET_COUNTS=off`: every facet counted over the
  // read, as before this existed. Worth having because the counts are most of
  // a search's upstream requests — a year facet is ten of them for each source
  // that counts one at a time.
  if (!countAcrossSources) return { filtersSent };

  const facetQueries: FacetQueries = {};
  for (const facet of Object.keys(OWN_FILTER) as CountedFacet[]) {
    const own = OWN_FILTER[facet];
    if (readOnly.some(key => key !== own)) continue;
    if (facet !== 'year' && !yearsExact) continue;

    facetQueries[facet] =
      facet === 'year' ? ask(bound, true)
      : facet === 'stage' ? ask(yearsToSend(bound, ticked), false)
      : query;
  }

  return { facetQueries, filtersSent };
}

export type RunOptions = {
  /** Defaults to `DEFAULT_SEARCH_SETTINGS`. */
  settings?: SearchSettings;
  /** Shared across requests, which is the only way caching a fan-out pays. */
  cache?: ProviderCache;
  /** Likewise for resolved sets, which is what keeps a search's pages slices of one set. */
  resultSets?: ResultSetCache;
  /** And for what the authorities said, so a page shown again is not asked about again. */
  authorityFacts?: AuthorityFactsCache;
  /** Tallies each source's reports across searches. */
  stats?: UpstreamStats;
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
  return (await runSearch(params, options)).response;
}

/**
 * `runOrchestrator`, also saying whether the result set was held rather than
 * resolved for this request — which the response shape has nowhere to put and
 * the route reports in `X-Cache-Hit`.
 */
export async function runSearch(
  params: SearchParams,
  options: RunOptions = {}
): Promise<{ response: SearchResponse; fromCache: boolean }> {
  const filters = params.filters ?? {};
  const settings = options.settings ?? DEFAULT_SEARCH_SETTINGS;
  const { yearFrom, yearTo } = filters;

  // The bounds go into the Query so a provider that can express a year filter
  // applies it upstream and spends its page budget on records in range. They
  // stay in the policy filter too: a provider that cannot express one still
  // returns records outside it, and `capabilities.yearFilter` is what says
  // which case a provider is in.
  const bound = yearFrom !== undefined || yearTo !== undefined
    ? {
        ...(yearFrom !== undefined ? { from: yearFrom } : {}),
        ...(yearTo !== undefined ? { to: yearTo } : {})
      }
    : undefined;

  /**
   * The year and publication-type facets are sent too, for the same reason.
   *
   * They used to be applied only to what came back, so ticking "2024" narrowed
   * a read of the top of every source's whole answer — a few hundred papers
   * from 2024, out of the hundred thousand the sources held. Sent, each source
   * spends its read on 2024, its count is a count of 2024, and the list is the
   * top of what the reader asked for. Both stay in the pipeline's own filter,
   * which is a no-op where the source applied them and does the rest where it
   * could not.
   */
  const ticked = tickedYears(filters);
  const userFilters = toUserFilters(filters);
  const stages = userFilters.stage as PaperStage[] | undefined;

  // `doi` wins over `q` when both are set: it is the more specific statement
  // of what the caller wants. The old path never read the field at all, so a
  // DOI only worked when it was typed into `q` — which `parseQuery` still
  // detects.
  const text = params.doi ?? params.q ?? '';
  const ask = (years: YearRange | undefined, withStages: boolean): Query => {
    const parsed = parseQuery(text, { ...(years ? { years } : {}) });
    return withStages && stages?.length && !parsed.doi ? { ...parsed, stages: [...stages] } : parsed;
  };

  const query = ask(yearsToSend(bound, ticked), true);
  const { facetQueries, filtersSent } = sourceCounting(filters, query, ask, bound, settings.facetCounts);

  const openAccessOnly = filters.openAccessOnly ?? true;

  const result = await orchestratorSearch(query, {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    depth: settings.depth,
    filters: userFilters,
    sort: params.sort ?? 'relevance',
    openAccessOnly,
    filtersSent,
    ...(facetQueries ? { facetQueries } : {}),
    policy: { requireOpenAccess: openAccessOnly },
    rescueLimit: settings.rescueLimit,
    rescueBudgetMs: settings.rescueBudgetMs,
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.resultSets ? { resultSets: options.resultSets } : {}),
    ...(options.authorityFacts ? { authorityFacts: options.authorityFacts } : {}),
    ...(options.stats ? { stats: options.stats } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.providers ? { providers: options.providers } : {}),
    ...(options.authorities ? { authorities: options.authorities } : {})
  });

  // The one step that changes which papers are in the result, and the only
  // one whose accounting the response shape has nowhere to put. Logged so a
  // bounded rescue — the case where `total` is still a lower bound — is
  // visible without waiting on a contract change. Debug, because it is one
  // line per resolved set and says nothing when there was nothing to ask.
  if (result.rescue.candidates > 0 && !result.fromCache) {
    const { authorities: _asked, ...counts } = result.rescue;
    log.debug('Rescue pass', { query: params.q, ...counts });
  }

  const response = toSearchResponse(result, {
    // Echoed the way the old path echoed them, absent field included, so the
    // response is the same object to a client that cannot tell which path
    // produced it.
    ...(params.filters !== undefined ? { filters: params.filters } : {}),
    sort: params.sort ?? 'relevance'
  });

  return { response, fromCache: result.fromCache };
}
