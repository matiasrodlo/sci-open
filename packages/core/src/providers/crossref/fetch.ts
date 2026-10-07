import { getPooledClient } from '../../lib/http-client-factory';
import { crossrefRequest } from '../../lib/crossref-pace';

/** The only I/O in this provider besides the authority's single-DOI request, which it reuses. */

const DEFAULT_BASE_URL = 'https://api.crossref.org';

/**
 * The fields read: what `normalizeWork` uses, and nothing else. A work's
 * reference list alone can run to hundreds of entries.
 *
 * Not `language`, which a single-DOI record carries and a list cannot select:
 * asked for, Crossref answers the whole search 400. Measured live, every
 * title search failed so until it was taken out.
 */
const SELECT = [
  'DOI', 'title', 'subtitle', 'author', 'issued', 'published-print', 'published-online',
  'container-title', 'short-container-title', 'volume', 'issue', 'page', 'article-number',
  'type', 'is-referenced-by-count', 'link', 'abstract', 'publisher', 'subject', 'updated-by'
].join(',');

export type FetchOptions = {
  baseUrl?: string;
  pageSize: number;
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type CrossrefListPayload = { message?: { items?: unknown[]; 'total-results'?: number } };

/** One page of a search, inside Crossref's limits for a list. */
export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<CrossrefListPayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;
  const params = new URLSearchParams(nativeQuery);
  params.set('rows', String(pageSize));
  if (offset > 0) params.set('offset', String(offset));
  params.set('select', SELECT);

  const client = getPooledClient(baseUrl);
  const response = await crossrefRequest('list', () => client.get<CrossrefListPayload>(`/works?${params}`, {
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  }), { maxWaitMs: timeoutMs, ...(userAgent ? { userAgent } : {}), ...(signal ? { signal } : {}) });

  // The pooled client resolves anything under 500. The status rides along so
  // the fan-out reads a 429 as the rate limit it is.
  if (response.status >= 400) throw Object.assign(new Error(`Crossref ${response.status}`), { status: response.status });
  if (!Array.isArray(response.data?.message?.items)) throw new Error(`Crossref returned no items (HTTP ${response.status})`);
  return response.data;
}
