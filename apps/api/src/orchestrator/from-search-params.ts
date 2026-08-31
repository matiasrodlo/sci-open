import type { PaperStage, SearchFilters, SearchParams, SearchResponse } from '@open-access-explorer/shared';
import { search as orchestratorSearch } from './index';
import { parseQuery } from './parse-query';
import type { UserFilters } from './policy';
import type { ProviderCache } from './provider-cache';
import type { ProviderEntry } from './registry';
import type { AuthorityEntry } from '../authorities';
import { toSearchResponse } from './to-search-response';

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
    filters: toUserFilters(filters),
    sort: params.sort ?? 'relevance',
    openAccessOnly,
    policy: { requireOpenAccess: openAccessOnly },
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.providers ? { providers: options.providers } : {}),
    ...(options.authorities ? { authorities: options.authorities } : {})
  });

  return toSearchResponse(result, {
    // Echoed the way the old path echoed them, absent field included, so the
    // response is the same object to a client that cannot tell which path
    // produced it.
    ...(params.filters !== undefined ? { filters: params.filters } : {}),
    sort: params.sort ?? 'relevance'
  });
}
