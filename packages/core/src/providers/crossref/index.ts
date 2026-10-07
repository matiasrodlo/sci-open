import type { Paper, Query } from '@sci-open/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, type FetchOptions } from './fetch';
import { normalize, type SkippedRecord } from './normalize';
import { lookupDoi } from '../../authorities/crossref/fetch';

export { capabilities, translate, fetchPage, normalize };
export type { TranslateOptions, FetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    now?: () => Date;
  };

/** DOIs to a `resolveDois` request: fifty, as many as a filter was measured to take at once. */
export const DOIS_PER_REQUEST = 50;

/**
 * The records for a list of DOIs, in one request: a filter of `doi:` values,
 * which Crossref ORs. Measured with fifty: one request, every registered DOI
 * answered, the rest absent. A DOI holding a comma would split the filter, so
 * the caller leaves those out.
 */
export async function lookupDois(
  dois: readonly string[],
  options: Omit<FetchOptions, 'pageSize' | 'offset'> & { now?: () => Date }
): Promise<Paper[]> {
  const { now = () => new Date(), ...fetchOptions } = options;
  if (dois.length === 0) return [];
  const filter = new URLSearchParams({ filter: dois.map(doi => `doi:${doi}`).join(',') }).toString();
  const payload = await fetchPage(filter, { ...fetchOptions, pageSize: dois.length, offset: 0 });
  return normalize(payload.message?.items ?? [], { retrievedAt: now().toISOString() }).papers;
}

export async function search(query: Query, options: SearchOptions): Promise<{ papers: Paper[]; skipped: SkippedRecord[] }> {
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;
  const retrievedAt = now().toISOString();

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [] };

  // A DOI is one record, at the single-record endpoint and its higher limit.
  if (nativeQuery.startsWith('doi:')) {
    if (offset > 0) return { papers: [], skipped: [] };
    const payload = await lookupDoi(nativeQuery.slice('doi:'.length), {
      timeoutMs: fetchOptions.timeoutMs,
      ...(fetchOptions.baseUrl ? { baseUrl: fetchOptions.baseUrl } : {}),
      ...(fetchOptions.signal ? { signal: fetchOptions.signal } : {}),
      ...(fetchOptions.userAgent ? { userAgent: fetchOptions.userAgent } : {})
    });
    return normalize(payload?.message ? [payload.message] : [], { retrievedAt });
  }

  const payload = await fetchPage(nativeQuery, {
    ...fetchOptions,
    pageSize: Math.min(Math.max(pageSize, 1), capabilities.maxPageSize),
    offset
  });
  return normalize(payload.message?.items ?? [], { retrievedAt, rankOffset: offset });
}
