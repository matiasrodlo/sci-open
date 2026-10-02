import type { Paper, ProviderId, SearchParams, SearchResponseV2 } from '@open-access-explorer/shared';
import { runSearch, DEFAULT_SEARCH_SETTINGS, type SearchSettings } from './orchestrator/from-search-params';
import { ProviderCache } from './orchestrator/provider-cache';
import { ResultSetCache } from './orchestrator/result-set';
import { AuthorityCache, AuthorityFactsCache } from './orchestrator/authority-cache';
import { UpstreamStats } from './orchestrator/upstream-stats';
import { lookupPaper } from './orchestrator/lookup';
import { countSearch, type CountOutcome } from './orchestrator/count';
import type { SearchProgress } from './orchestrator/progress';
import { QuotaState } from './orchestrator/quota';
import { parseQuery } from './orchestrator/parse-query';
import { normalizeDoi } from './orchestrator/merge';
import { enrichPage } from './orchestrator/enrich';
import { PROVIDERS, type ProviderEntry } from './orchestrator/registry';
import { AUTHORITIES, type AuthorityEntry } from './authorities';
import { useApiKeys, type ApiKeys } from './lib/api-key';
import { configureHttpPools, type HttpPoolSettings } from './lib/http-pool-config';
import { doiRegistered } from './lib/doi-registry';
import { SingleFlight } from './lib/single-flight';
import { resolveFullText } from './fulltext/resolve';
import { FullTextCache } from './fulltext/cache';
import type { FullTextDocument } from './fulltext/types';
import { citationLinks as fetchCitationLinks, type CitationDirection, type CitationLink } from './graph/opencitations';
import { fetchWorksByDoi, OpenAlexUnavailableError, WORKS_BY_DOI_MAX } from './providers/openalex/fetch';
import { normalize as normalizeOpenAlex } from './providers/openalex/normalize';
import { apiKeyFor } from './lib/api-key';
import { log } from './lib/logger';

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
  /** How long a source that answered 429 is left alone. Ten minutes by default. */
  quotaCoolDownMs?: number;
  /** The clock the cool-down runs on, for tests. */
  now?: () => number;
  /** Byte budget for full texts held between reads. 32 MB by default. */
  fullTextBytes?: number;
  /** OpenCitations' access token, which raises its rate limit. */
  openCitationsToken?: string;
};

export type SearchOutcome = { response: SearchResponseV2; fromCache: boolean };

/** What `resolveDois` found, by lower-cased DOI, and the DOIs it could not ask
 * about: OpenAlex failed or was cooling down, or the DOI cannot be listed in
 * an OpenAlex filter. A DOI in neither was asked about and is not in OpenAlex. */
export type DoiResolution = { found: Map<string, Paper>; unasked: string[] };

type Admit = () => Promise<void>;

/** What a search or a count can be told besides its params. */
export type SearchCallOptions = {
  /** Asked only when something must be asked of the sources; may throw to refuse. */
  admit?: Admit;
  /** Narrows the fan-out to these providers. */
  sources?: readonly string[];
  /** Each source as it settles, then the access check and the page's details. */
  onProgress?: (event: SearchProgress) => void;
};

export type Engine = {
  readonly userAgent: string;
  /** The same pipeline as POST /api/v2/search. `admit` is asked only when a
   * new result set must be resolved, never for a page of a held one.
   * `sources` narrows the fan-out to those providers. */
  search(params: SearchParams, options?: SearchCallOptions): Promise<SearchOutcome>;
  /** Each source's own match count for these params, with nothing read (see
   * `countSearch`). Spends an admission: it is still a request to every source. */
  count(params: SearchParams, options?: SearchCallOptions): Promise<CountOutcome>;
  /** A paper by sci-open id (`provider:nativeId`), enriched by the authorities.
   * Asks only the provider the id names. */
  lookup(id: string): Promise<Paper | null>;
  /** A paper by DOI, whether or not it is open access, merged across every
   * source that holds it. A DOI lookup is a search, and spends an admission
   * like one. */
  lookupDoi(doi: string, options?: { admit?: Admit }): Promise<Paper | null>;
  /** Whether the DOI system holds this DOI at all — whoever registered it.
   * `undefined` when the registry could not say. One request, no admission. */
  doiRegistered(doi: string): Promise<boolean | undefined>;
  /** The best-structured legal open-access full text of a paper, or null.
   * Held for an hour, so its sections are read without fetching it again.
   * Throws `SourceBusyError` when the only copy is on a paced host with no
   * slot soon enough: a copy that cannot be fetched yet, not no copy. */
  readFullText(paper: Paper, options: { trustedOnly: boolean }): Promise<FullTextDocument | null>;
  /** Every OpenCitations link of a paper, by DOI: what it cites
   * (`references`) or what cites it (`cited_by`). Held ten minutes, so a list
   * is fetched once however it is paged. No admission: one request, to a
   * source the search does not ask. */
  citationLinks(doi: string, direction: CitationDirection): Promise<CitationLink[]>;
  /** Records for a list of DOIs from OpenAlex, fifty to a request, as
   * OpenAlex alone has them: not merged with other sources, not enriched.
   * Enough to cite a paper or list it. Not a search, and no admission. */
  resolveDois(dois: readonly string[]): Promise<DoiResolution>;
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

  /**
   * The sources whose rate limit refused a recent request, left out until it
   * can answer. One per engine — per process, which over HTTP means one for
   * every client, as it should be: the budget it protects is the process's.
   */
  const quota = new QuotaState({
    ...(options.quotaCoolDownMs !== undefined ? { coolDownMs: options.quotaCoolDownMs } : {}),
    ...(options.now ? { now: options.now } : {})
  });

  const now = options.now ?? Date.now;

  /**
   * Citation lists held between pages, oldest first, ten minutes each. Bounded
   * by links rather than lists: a much-cited paper has tens of thousands of
   * citers, and two hundred of those lists would hold millions of links.
   */
  const linkLists = new Map<string, { expires: number; links: CitationLink[] }>();
  let heldLinks = 0;
  const linkFlights = new SingleFlight();
  const LINK_BUDGET = 200_000;
  const LINK_HOLD_MS = 10 * 60_000;
  const dropList = (key: string) => {
    const held = linkLists.get(key);
    if (!held) return;
    linkLists.delete(key);
    heldLinks -= held.links.length;
  };

  const fullTexts = new FullTextCache(options.fullTextBytes !== undefined ? { maxBytes: options.fullTextBytes } : {});
  /** Two reads of one paper at once fetch it once. */
  const fullTextFlights = new SingleFlight();

  /** OpenAlex the authority is billed against the same budget as OpenAlex the
   * source, so a cooled-down OpenAlex is left out of enrichment too. */
  const authoritiesNow = (unavailable: ReadonlyMap<ProviderId, string>) =>
    unavailable.size
      ? { authorities: (options.authorities ?? AUTHORITIES).filter(a => !unavailable.has(a.id as ProviderId)) }
      : authorities;

  /** The registry, or the part of it a caller narrowed the search to. */
  const narrowed = (sources?: readonly string[]) =>
    sources?.length ? providers.filter(p => sources.includes(p.id)) : providers;

  const search: Engine['search'] = async (params, extra = {}) => {
    const unavailable = quota.unavailable();
    const { responseV2, fromCache } = await runSearch(params, {
      settings,
      cache: providerCache,
      resultSets,
      authorityFacts,
      stats,
      userAgent,
      ...authoritiesNow(unavailable),
      ...(unavailable.size ? { unavailable } : {}),
      ...(extra.admit ? { admit: extra.admit } : {}),
      ...(extra.onProgress ? { onProgress: extra.onProgress } : {}),
      // Safe to share the caches: the result-set key includes the provider
      // list, so a narrowed set never answers a full search, or the reverse.
      providers: narrowed(extra.sources)
    });
    // A held set's reports are what was learned when it was resolved.
    if (!fromCache) quota.note(responseV2.providers);
    return { response: responseV2, fromCache };
  };

  return {
    userAgent,
    stats,
    search,
    async count(params, extra = {}) {
      // The provider cache keys on the depth, so a count and a search never
      // answer each other, and a count repeated while variants are compared
      // is answered from it. A repeat still spends an admission: the cache
      // cannot say in advance whether it holds every source's answer.
      const unavailable = quota.unavailable();
      const outcome = await countSearch(params, {
        providers: narrowed(extra.sources),
        cache: providerCache,
        userAgent,
        ...(unavailable.size ? { unavailable } : {}),
        ...(extra.admit ? { admit: extra.admit } : {}),
        ...(extra.onProgress ? { onProgress: extra.onProgress } : {})
      });
      quota.note(outcome.reports);
      return outcome;
    },
    async lookup(id) {
      // Not gated: a lookup asks one provider through its entity endpoint,
      // which OpenAlex does not bill against the search budget. Its enrichment
      // is, so it leaves out a cooled-down OpenAlex like a search's.
      const found = await lookupPaper(id, { userAgent, providers });
      if (!found) return null;
      const { papers } = await enrichPage([found], {
        userAgent, cache: new AuthorityCache(authorityFacts), ...authoritiesNow(quota.unavailable())
      });
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
    },
    doiRegistered: doi => doiRegistered(doi, { userAgent }),
    async citationLinks(doi, direction) {
      const key = `${direction}|${normalizeDoi(doi)}`;
      const held = linkLists.get(key);
      if (held && held.expires > now()) return held.links;
      dropList(key);
      // Two pages asked for at once fetch the list once, and hold it once.
      const { value } = await linkFlights.run(key, async () => {
        const links = await fetchCitationLinks(doi, direction, {
          userAgent,
          ...(options.openCitationsToken ? { token: options.openCitationsToken } : {})
        });
        if (links.length <= LINK_BUDGET) {
          dropList(key);
          for (const oldest of linkLists.keys()) {
            if (heldLinks + links.length <= LINK_BUDGET) break;
            dropList(oldest);
          }
          linkLists.set(key, { expires: now() + LINK_HOLD_MS, links });
          heldLinks += links.length;
        }
        return links;
      });
      return value;
    },
    async resolveDois(dois) {
      const wanted = [...new Set(dois.map(normalizeDoi))].filter(Boolean);
      const found = new Map<string, Paper>();
      const unasked = wanted.filter(doi => /[|,]/.test(doi));
      const listable = wanted.filter(doi => !/[|,]/.test(doi));
      for (let i = 0; i < listable.length; i += WORKS_BY_DOI_MAX) {
        const batch = listable.slice(i, i + WORKS_BY_DOI_MAX);
        // OpenAlex the batch is billed against the same budget as OpenAlex the
        // source: while one is cooling down, so is the other.
        if (quota.unavailable().has('openalex')) {
          unasked.push(...listable.slice(i));
          break;
        }
        try {
          const payload = await fetchWorksByDoi(batch, { userAgent, timeoutMs: 15_000, ...apiKeyFor('openalex') });
          const { papers } = normalizeOpenAlex(payload, { retrievedAt: new Date().toISOString() });
          for (const paper of papers) if (paper.doi) found.set(normalizeDoi(paper.doi), paper);
        } catch (error) {
          // One batch's failure is its own: the others are still worth asking,
          // unless this one was refused for the budget.
          if (error instanceof OpenAlexUnavailableError && error.status === 429) quota.refuse('openalex');
          log.warn('OpenAlex did not resolve a batch of DOIs', { dois: batch.length, err: error instanceof Error ? error.message : String(error) });
          unasked.push(...batch);
        }
      }
      return { found, unasked };
    },
    async readFullText(paper, { trustedOnly }) {
      // Trusted mode reads fewer tiers, so its answer is held apart.
      const key = `${paper.id}|${trustedOnly ? 'trusted' : 'any'}`;
      const held = fullTexts.get(key);
      if (held !== undefined) return held;
      const { value } = await fullTextFlights.run(key, async () => {
        const { doc, definitive } = await resolveFullText(paper, { userAgent, trustedOnly });
        if (doc || definitive) fullTexts.set(key, doc);
        return doc;
      });
      return value;
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
