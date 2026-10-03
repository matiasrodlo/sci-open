import type { Paper, Query } from '@sci-open/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, DataCiteUnavailableError, type FetchOptions } from './fetch';
import { normalize, totalHits, type SkippedRecord } from './normalize';

export { capabilities, translate, fetchPage, normalize, totalHits, DataCiteUnavailableError };
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
};

export async function search(query: Query, options: SearchOptions): Promise<ProviderSearchResult> {
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [] };

  const payload = await fetchPage(nativeQuery, {
    ...fetchOptions,
    pageSize: Math.min(Math.max(pageSize, 1), capabilities.maxPageSize),
    offset
  });

  const { papers, skipped } = normalize(payload, {
    retrievedAt: now().toISOString(),
    rankOffset: offset
  });

  const reported = totalHits(payload);
  return {
    papers,
    ...(reported !== undefined ? { totalHits: reported } : {}),
    skipped
  };
}
