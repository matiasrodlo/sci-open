import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, toParams, type TranslateOptions } from './translate';
import { fetchPage, OpenAireUnavailableError, type FetchOptions } from './fetch';
import { normalize, totalHits, type SkippedRecord } from './normalize';

export { capabilities, translate, toParams, fetchPage, normalize, totalHits, OpenAireUnavailableError };
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
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const params = toParams(query, { openAccessOnly });
  if (!params.keywords && !params.doi) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();
  const payload = await fetchPage(params, {
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
 * One paper by its OpenAIRE `objIdentifier`.
 *
 * Verified live 2026-08-30 on `doi_dedup___::e102f905c7609789b70634cf0ecde7cd`:
 * `total` is 1 and the record's own objIdentifier is the one asked for. The
 * match is checked here regardless, because the parameter's query expansion
 * also matches on `resultdupid` — a deduplicated sibling would come back under
 * a different id, and that is a different record.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchPage(
    { openairePublicationID: nativeId, format: 'json' },
    { ...fetchOptions, pageSize: 1, offset: 0 }
  );
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers.find(paper => paper.sources[0]?.nativeId === nativeId) ?? null;
}
