import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, CoreUnavailableError, type FetchOptions } from './fetch';
import { normalize, totalHits, pickFullText, type SkippedRecord } from './normalize';

export { capabilities, translate, fetchPage, normalize, totalHits, pickFullText, CoreUnavailableError };
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
  const { openAccessOnly, pageSize = 25, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();
  const payload = await fetchPage(nativeQuery, {
    ...fetchOptions,
    pageSize: Math.min(Math.max(pageSize, 1), capabilities.maxPageSize),
    offset
  });

  const latency = Date.now() - started;
  const { papers, skipped } = normalize(payload, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  const reported = totalHits(payload);
  return {
    papers,
    ...(reported !== undefined ? { totalHits: reported } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = Omit<FetchOptions, 'pageSize' | 'offset'> & { now?: () => Date };

/**
 * One paper by its CORE id.
 *
 * A search with an `id:` clause, not `/v3/works/{id}` — that endpoint answers
 * **HTTP 500**, measured 2026-08-30 on CORE id `8657725`, where
 * `q=id:8657725` returns exactly that one record. This is the query the old
 * paper endpoint sent, and it is the one thing about that endpoint that was
 * addressed to the right thing.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchPage(`id:${nativeId}`, { ...fetchOptions, pageSize: 1, offset: 0 });
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers.find(paper => paper.sources[0]?.nativeId === nativeId) ?? null;
}
