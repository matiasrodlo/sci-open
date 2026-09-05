import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, fetchRecord, type FetchOptions, type RecordFetchOptions } from './fetch';
import { normalize, totalHits, ArxivQueryError, type SkippedRecord } from './normalize';

/**
 * arXiv as a provider: capabilities, a pure translate, one I/O call, and a
 * pure normalise.
 *
 * The assembly is deliberately thin — it owns no timeout, swallows no error
 * and makes no open-access decision. Those are the orchestrator's.
 */

export { capabilities, translate, fetchPage, fetchRecord, normalize, totalHits, ArxivQueryError };
export type { TranslateOptions, FetchOptions, RecordFetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    /** Clock injected so the result is reproducible in tests. */
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  totalHits?: number;
  skipped: SkippedRecord[];
  latency: number;
};

export async function search(
  query: Query,
  options: SearchOptions
): Promise<ProviderSearchResult> {
  const {
    openAccessOnly,
    pageSize = 50,
    offset = 0,
    now = () => new Date(),
    ...fetchOptions
  } = options;

  const nativeQuery = translate(query, { openAccessOnly });

  // Nothing to ask. arXiv answers an empty `search_query` with an error
  // document, so this is a real case rather than a defensive one — and a
  // request that cannot mean anything is not worth a round trip.
  if (!nativeQuery) {
    return { papers: [], skipped: [], latency: 0 };
  }

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

export type LookupOptions = RecordFetchOptions & { now?: () => Date };

/** One paper by its arXiv identifier, with or without a version suffix. */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchRecord(nativeId, fetchOptions);
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers[0] ?? null;
}
