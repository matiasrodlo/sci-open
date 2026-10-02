import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import {
  fetchPage, fetchRecord, fetchCount, NcbiUnavailableError,
  type FetchOptions, type RecordFetchOptions, type CountFetchOptions
} from './fetch';
import { normalize, type SkippedRecord } from './normalize';
import { readPages } from '../read-pages';
import { countFacets, type Pace, type ProviderFacetArgs, type ProviderFacetOutcome } from '../count-facets';
import { log } from '../../lib/logger';
import { usableApiKey } from '../../lib/api-key';

/**
 * PubMed as a provider: capabilities, a pure translate, the two E-utilities
 * calls, and a pure normalise.
 */

export { capabilities, translate, fetchPage, fetchRecord, fetchCount, normalize, NcbiUnavailableError };
export type { TranslateOptions, FetchOptions, RecordFetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  totalHits?: number;
  skipped: SkippedRecord[];
  latency: number;
};

export async function search(query: Query, options: SearchOptions): Promise<ProviderSearchResult> {
  const {
    openAccessOnly,
    pageSize = 50,
    offset = 0,
    now = () => new Date(),
    ...fetchOptions
  } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();

  // PubMed's page here is 500 and the orchestrator asks for `depth` — 600 by
  // default — so a search retrieved 500 and `ProviderReport` recorded it as a
  // complete read. Smaller than the shortfall DOAJ and OpenAIRE had, and the
  // same kind of silence. See `providers/read-pages.ts`.
  //
  // The 500 is ours rather than NCBI's: efetch takes up to 10,000 UIDs in a
  // POST body, and the ceiling exists to bound how much abstract XML one
  // response carries. Paginating keeps that bound and still fills the depth,
  // where raising the number would abandon it — and would put the shortfall
  // back the moment `DEFAULT_DEPTH` moved.
  //
  // `exactLastPage` because this provider addresses records by `retstart`, an
  // absolute offset, so the closing request asks for the 100 still wanted
  // rather than a full page that is then trimmed. Without it a broad search
  // would fetch 1,000 abstracts to return 600.
  const { items, total, requests } = await readPages({
    wanted: pageSize,
    perPage: capabilities.maxPageSize,
    offset,
    exactLastPage: true,
    fetch: page => fetchPage(nativeQuery, { ...fetchOptions, ...page }),
    itemsOf: payload => payload?.articles ?? [],
    totalOf: payload => payload?.totalHits
  });

  const latency = Date.now() - started;
  const { papers, skipped } = normalize(items, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  // Each page is two calls — esearch then efetch — so `requests` here is pages,
  // not HTTP requests.
  log.debug('PubMed read', { requests, retrieved: papers.length, wanted: pageSize });

  return {
    papers,
    ...(total !== undefined ? { totalHits: total } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = RecordFetchOptions & { now?: () => Date };

/** One paper by its PMID. */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const { articles } = await fetchRecord(nativeId, fetchOptions);
  const latency = Date.now() - started;

  const { papers } = normalize(articles, { retrievedAt: now().toISOString(), latency });
  return papers[0] ?? null;
}

export type CountOptions = TranslateOptions & CountFetchOptions;

/** PubMed's count for a query. See `fetchCount`. */
export async function count(query: Query, options: CountOptions): Promise<number> {
  const { openAccessOnly, ...fetchOptions } = options;
  const nativeQuery = translate(query, { openAccessOnly });
  return nativeQuery ? fetchCount(nativeQuery, fetchOptions) : 0;
}

/**
 * E-utilities allow three requests a second without a key and ten with one,
 * over any second rather than per bucket refill — so no burst: a burst of two
 * followed by 2.5 a second put four requests inside the first second and drew
 * a 429, 2026-09-25. One at a time at 2.5 a second never has more than three
 * in any second.
 */
function paceFor(apiKey: string | undefined): Pace {
  return usableApiKey(apiKey) ? { burst: 1, perSecond: 9 } : { burst: 1, perSecond: 2.5 };
}

/** Year and stage counts across everything PubMed matches. See `count-facets.ts`. */
export function facets(args: ProviderFacetArgs, options: { apiKey?: string } = {}): Promise<ProviderFacetOutcome> {
  return countFacets(args, {
    holds: capabilities.stages.holds,
    translate: query => translate(query, { openAccessOnly: args.openAccessOnly }),
    count: query => count(query, {
      openAccessOnly: args.openAccessOnly,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      timeoutMs: args.timeoutMs,
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.userAgent ? { userAgent: args.userAgent } : {})
    }),
    pace: paceFor(options.apiKey),
    ...(args.signal ? { signal: args.signal } : {})
  });
}
