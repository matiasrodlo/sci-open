import type { Paper, SearchParams, SearchResponseV2 } from '@open-access-explorer/shared';
import { runSearch, DEFAULT_SEARCH_SETTINGS, type SearchSettings } from './orchestrator/from-search-params';
import { ProviderCache } from './orchestrator/provider-cache';
import { ResultSetCache } from './orchestrator/result-set';
import { AuthorityCache, AuthorityFactsCache } from './orchestrator/authority-cache';
import { UpstreamStats } from './orchestrator/upstream-stats';
import { lookupPaper } from './orchestrator/lookup';
import { parseQuery } from './orchestrator/parse-query';
import { normalizeDoi } from './orchestrator/merge';
import { enrichPage } from './orchestrator/enrich';
import { PROVIDERS, type ProviderEntry } from './orchestrator/registry';
import type { AuthorityEntry } from './authorities';
import { useApiKeys, type ApiKeys } from './lib/api-key';
import { configureHttpPools, type HttpPoolSettings } from './lib/http-pool-config';

/**
 * One object, made once per process, that owns the caches and exposes exactly
 * what a caller other than the API's routes needs: the MCP server's tools, its
 * CLI, the scripts that record its fixtures.
 *
 * Callers depend on the `Engine` type, not on this function, so a test or an
 * eval can hand them a fixture engine instead. The API keeps building its own
 * caches and calling the orchestrator; it can hand those caches to an engine
 * (`caches`) so the two hold one set of results between them.
 */

export type EngineCaches = {
  providerCache: ProviderCache;
  resultSets: ResultSetCache;
  authorityFacts: AuthorityFactsCache;
  stats: UpstreamStats;
};

export type EngineOptions = {
  /** Sent to every upstream; must carry a real contact (see UNPAYWALL_EMAIL). */
  userAgent: string;
  /** Installed process-wide. Omit when embedding in a host that already did
   * (the API): passing `{}` would clear the host's keys. */
  apiKeys?: ApiKeys;
  /** Likewise process-wide, and likewise omitted by a host that configured it. */
  httpPool?: HttpPoolSettings;
  search?: Partial<SearchSettings>;
  /** A host's own caches, so the host and this engine share held sets.
   * Without it the engine makes its own. */
  caches?: EngineCaches;
  providerCacheBytes?: number;
  resultSetBytes?: number;
  /** Subsets of the registries: how the engine is driven offline in tests. */
  providers?: readonly ProviderEntry[];
  authorities?: readonly AuthorityEntry[];
};

export type SearchOutcome = { response: SearchResponseV2; fromCache: boolean };

type Admit = () => Promise<void>;

export type Engine = {
  readonly userAgent: string;
  /** The same pipeline as POST /api/v2/search. `admit` is asked only when a
   * new result set must be resolved, never for a page of a held one.
   * `sources` narrows the fan-out to those providers. */
  search(params: SearchParams, options?: { admit?: Admit; sources?: readonly string[] }): Promise<SearchOutcome>;
  /** A paper by sci-open id (`provider:nativeId`), enriched by the authorities.
   * Asks only the provider the id names. */
  lookup(id: string): Promise<Paper | null>;
  /** A paper by DOI, whether or not it is open access, merged across every
   * source that holds it. A DOI lookup is a search, and spends an admission
   * like one. */
  lookupDoi(doi: string, options?: { admit?: Admit }): Promise<Paper | null>;
  stats: UpstreamStats;
};

export function createEngine(options: EngineOptions): Engine {
  if (options.apiKeys) useApiKeys(options.apiKeys);
  if (options.httpPool) configureHttpPools(options.httpPool);

  const settings: SearchSettings = { ...DEFAULT_SEARCH_SETTINGS, ...options.search };
  const { providerCache, resultSets, authorityFacts, stats } = options.caches ?? {
    providerCache: new ProviderCache(
      options.providerCacheBytes !== undefined ? { maxBytes: options.providerCacheBytes } : {}
    ),
    resultSets: new ResultSetCache(options.resultSetBytes !== undefined ? { maxBytes: options.resultSetBytes } : {}),
    authorityFacts: new AuthorityFactsCache(),
    stats: new UpstreamStats()
  };
  const { userAgent } = options;
  const providers = options.providers ?? PROVIDERS;
  const authorities = options.authorities ? { authorities: options.authorities } : {};

  /** The registry, or the part of it a caller narrowed the search to. */
  const narrowed = (sources?: readonly string[]) =>
    sources?.length ? providers.filter(p => sources.includes(p.id)) : providers;

  const search: Engine['search'] = async (params, extra = {}) => {
    const { responseV2, fromCache } = await runSearch(params, {
      settings,
      cache: providerCache,
      resultSets,
      authorityFacts,
      stats,
      userAgent,
      ...authorities,
      ...(extra.admit ? { admit: extra.admit } : {}),
      // Safe to share the caches: the result-set key includes the provider
      // list, so a narrowed set never answers a full search, or the reverse.
      providers: narrowed(extra.sources)
    });
    return { response: responseV2, fromCache };
  };

  return {
    userAgent,
    stats,
    search,
    async lookup(id) {
      const found = await lookupPaper(id, { userAgent, providers });
      if (!found) return null;
      const { papers } = await enrichPage([found], { userAgent, cache: new AuthorityCache(authorityFacts), ...authorities });
      return papers[0] ?? found;
    },
    async lookupDoi(doi, extra = {}) {
      // Text that is not a DOI would be searched as keywords, and the first
      // hit of that is somebody else's paper: asked nothing, it is no paper.
      const wanted = doiIn(doi);
      if (!wanted) return null;
      // Not open access only: a closed paper exists all the same, and a
      // reference check that could not see it would call it fabricated.
      const { response } = await search({ doi: wanted, filters: { openAccessOnly: false }, page: 1, pageSize: 1 }, extra);
      return response.papers.find(paper => paper.doi && normalizeDoi(paper.doi) === normalizeDoi(wanted)) ?? null;
    }
  };
}

/** The DOI `parseQuery` would route to a DOI lookup, bare or as a doi.org URL. */
function doiIn(text: string): string | undefined {
  try {
    return parseQuery(text).doi;
  } catch {
    return undefined; // not even a query, let alone a DOI
  }
}
