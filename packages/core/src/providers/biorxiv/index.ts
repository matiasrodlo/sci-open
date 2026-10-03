import type { Paper, Query } from '@sci-open/shared';
import { capabilities } from './capabilities';
import { fetchByDoi, SERVERS, type FetchOptions, type BiorxivServer } from './fetch';
import { normalize, type SkippedRecord } from './normalize';

export { capabilities, fetchByDoi, normalize, SERVERS };
export type { FetchOptions, SkippedRecord, BiorxivServer };

export type TranslateOptions = { openAccessOnly?: boolean };

/**
 * There is no query to build. The API has no keyword index and the DOI goes in
 * the path, so the "native query" is the DOI itself — which is all the
 * orchestrator needs it for, as a cache key.
 */
export function translate(query: Query, _options: TranslateOptions = {}): string {
  return query.doi ?? '';
}

export type SearchOptions = TranslateOptions &
  FetchOptions & {
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
  const { offset = 0, now = () => new Date(), ...fetchOptions } = options;

  // `capabilities.keywordSearch` is false, so the orchestrator never routes a
  // keyword query here. Returning empty rather than scanning a date window is
  // the same answer stated in the one place that would still be reachable.
  if (!query.doi) return { papers: [], skipped: [] };

  const collections = await fetchByDoi(query.doi, fetchOptions);

  const { papers, skipped } = normalize(collections, {
    retrievedAt: now().toISOString(),
    rankOffset: offset
  });

  return { papers, skipped };
}
