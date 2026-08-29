import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, EuropePmcUnavailableError, type FetchOptions } from './fetch';
import { normalize, type SkippedRecord } from './normalize';

/**
 * Europe PMC as a provider: capabilities, a pure translate, one I/O call, and a
 * pure normalise.
 *
 * The assembly is deliberately thin. It owns no timeout, swallows no error and
 * makes no open-access decision — those are the orchestrator's, and keeping
 * them out is what lets the same provider be driven differently by a search, a
 * DOI lookup, or a fixture-recording script.
 */

export { capabilities, translate, fetchPage, normalize, EuropePmcUnavailableError };
export type { TranslateOptions, FetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    /** Clock injected so the result is reproducible in tests. */
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  /** Europe PMC's own count of everything matching, for the ProviderReport. */
  totalHits?: number;
  /** Records that could not be read, so the caller can report rather than hide them. */
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

  const reported = Number(payload?.hitCount);

  return {
    papers,
    ...(Number.isFinite(reported) ? { totalHits: reported } : {}),
    skipped,
    latency
  };
}
