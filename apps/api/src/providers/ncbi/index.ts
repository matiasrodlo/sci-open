import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, NcbiUnavailableError, type FetchOptions } from './fetch';
import { normalize, type SkippedRecord } from './normalize';

/**
 * PubMed as a provider: capabilities, a pure translate, the two E-utilities
 * calls, and a pure normalise.
 */

export { capabilities, translate, fetchPage, normalize, NcbiUnavailableError };
export type { TranslateOptions, FetchOptions, SkippedRecord };

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

  const payload = await fetchPage(nativeQuery, {
    ...fetchOptions,
    pageSize: Math.min(Math.max(pageSize, 1), capabilities.maxPageSize),
    offset
  });

  const latency = Date.now() - started;
  const { papers, skipped } = normalize(payload.articles, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  return {
    papers,
    ...(payload.totalHits !== undefined ? { totalHits: payload.totalHits } : {}),
    skipped,
    latency
  };
}
