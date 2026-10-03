import type { PaperStage, ProviderId, Query, SearchFilters, SearchParams, SearchResponseV2 } from '@sci-open/shared';
import { isStructured } from '@sci-open/shared';
import type { FacetQueries } from './source-facets';
import { search as orchestratorSearch, DEFAULT_DEPTH } from './index';
import { parseQuery } from './parse-query';
import type { UserFilters } from './policy';
import type { ProviderCache } from './provider-cache';
import type { ResultSetCache } from './result-set';
import type { AuthorityFactsCache } from './authority-cache';
import type { SearchProgress } from './progress';
import type { ProviderEntry } from './registry';
import type { AuthorityEntry } from '../authorities';
import { toSearchResponseV2 } from './to-search-response';
import { log } from '../lib/logger';

/**
 * `SearchParams` -> the orchestrator, and its result -> `SearchResponseV2`.
 *
 * The mirror of `to-search-response`. The orchestrator itself speaks `Query`
 * and `Paper` and learns nothing about `SearchParams`.
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
    ...(stage.length > 0 ? { stage } : {})
  };
}

/** The settings that decide how much work a search does. */
export type SearchSettings = {
  /** How deep each provider is read. The orchestrator clamps it to `MAX_DEPTH`. */
  depth: number;
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = { depth: DEFAULT_DEPTH };

/**
 * Which facets to count across everything the sources match, and whether the
 * sources' own counts describe this search — both decided by one question: was
 * everything that narrows it sent to them?
 *
 * The year bound and the publication types are sent, so a search for 2024
 * preprints is shown how many 2024 preprints there are, not how many were in
 * the top of what was read. The source filter is not — it is this service's
 * own label — and with it set nothing is counted across the sources. The stage
 * facet is counted with its own selection lifted, so it still shows the other
 * stages.
 *
 * A structured query is widened for the sources that cannot express it —
 * OpenAIRE is sent `crispr` for `AU=Doudna AND crispr` — so its counts are of a
 * larger question, and nothing is counted across the sources for one.
 */
function sourceCounting(
  filters: SearchFilters,
  query: Query,
  withoutStages: Query
): { facetQueries?: FacetQueries; filtersSent: boolean } {
  if (query.doi || (query.expression && isStructured(query.expression))) return { filtersSent: false };

  const filtersSent = !filters.source?.length;
  if (!filtersSent) return { filtersSent };

  return {
    facetQueries: { year: query, stage: withoutStages, venue: query, publisher: query, topics: query },
    filtersSent
  };
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
  /** See `SearchOptions.admit`. */
  admit?: () => Promise<void>;
  /** See `SearchOptions.onProgress`. */
  onProgress?: (event: SearchProgress) => void;
  /** See `SearchOptions.unavailable`. */
  unavailable?: ReadonlyMap<ProviderId, string>;
  userAgent?: string;
  /** Defaults to the whole registry. A subset is how this is driven offline. */
  providers?: readonly ProviderEntry[];
  /** Likewise for the authorities. An empty list turns enrichment off. */
  authorities?: readonly AuthorityEntry[];
};

/**
 * What a search's params ask the sources: the query, with the years and
 * publication types sent rather than only filtered. `runSearch` and
 * `countSearch` both start here, so a count is a count of the search it
 * previews.
 */
export function queryOf(params: SearchParams) {
  const filters = params.filters ?? {};
  const { yearFrom, yearTo } = filters;

  // The bounds go into the Query so a provider that can express a year filter
  // applies it upstream and spends its page budget on records in range. They
  // stay in the policy filter too: a provider that cannot express one (bioRxiv
  // reads a date window, not a query) still returns records outside it.
  const bound = yearFrom !== undefined || yearTo !== undefined
    ? {
        ...(yearFrom !== undefined ? { from: yearFrom } : {}),
        ...(yearTo !== undefined ? { to: yearTo } : {})
      }
    : undefined;

  // Publication types are sent too, as stages, for the same reason: a source
  // that can express one spends its read on it and counts it. They stay in the
  // pipeline's own filter, which is a no-op where the source applied them.
  const userFilters = toUserFilters(filters);
  const stages = userFilters.stage as PaperStage[] | undefined;

  // `doi` wins over `q` when both are set: it is the more specific statement
  // of what the caller wants.
  const text = params.doi ?? params.q ?? '';
  const withoutStages = parseQuery(text, { ...(bound ? { years: bound } : {}) });
  const query: Query = stages?.length && !withoutStages.doi ? { ...withoutStages, stages: [...stages] } : withoutStages;
  const openAccessOnly = filters.openAccessOnly ?? true;

  return { filters, query, withoutStages, userFilters, openAccessOnly };
}

/**
 * A search's params in, its response out, and whether the result set was held
 * rather than resolved for this request.
 *
 * `openAccessOnly` defaults to true: every search returns open papers with a
 * retrievable copy unless it says otherwise.
 */
export async function runSearch(
  params: SearchParams,
  options: RunOptions = {}
): Promise<{ response: SearchResponseV2; fromCache: boolean }> {
  const { filters, query, withoutStages, userFilters, openAccessOnly } = queryOf(params);
  const settings = options.settings ?? DEFAULT_SEARCH_SETTINGS;
  const { facetQueries, filtersSent } = sourceCounting(filters, query, withoutStages);

  const result = await orchestratorSearch(query, {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    depth: settings.depth,
    filters: userFilters,
    sort: params.sort ?? 'relevance',
    openAccessOnly,
    filtersSent,
    ...(facetQueries ? { facetQueries } : {}),
    // Both gates follow the request. A search that includes papers which are
    // not open has asked for papers nobody can read: holding it to "has a
    // retrievable copy" still dropped every closed paper with none, so a
    // closed paper looked up by its DOI did not exist.
    policy: { requireOpenAccess: openAccessOnly, requireFullText: openAccessOnly },
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.resultSets ? { resultSets: options.resultSets } : {}),
    ...(options.authorityFacts ? { authorityFacts: options.authorityFacts } : {}),
    ...(options.admit ? { admit: options.admit } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.unavailable ? { unavailable: options.unavailable } : {}),
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
    log.debug('Rescue pass', { query: params.q, ...result.rescue });
  }

  return { response: toSearchResponseV2(result), fromCache: result.fromCache };
}
