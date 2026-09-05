import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import {
  fetchPage, fetchRecord, NcbiUnavailableError,
  type FetchOptions, type RecordFetchOptions
} from './fetch';
import { normalize, type SkippedRecord } from './normalize';
import { readPages } from '../read-pages';
import { log } from '../../lib/logger';

/**
 * PubMed as a provider: capabilities, a pure translate, the two E-utilities
 * calls, and a pure normalise.
 */

export { capabilities, translate, fetchPage, fetchRecord, normalize, NcbiUnavailableError };
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
