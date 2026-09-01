import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { parseStringPromise } from 'xml2js';

/**
 * The only I/O in this provider.
 *
 * It does not catch, and it owns no timeout of its own. The old connector did
 * both: a try/catch around everything returned `{ records: [] }` for a network
 * failure, a 500 and an empty corpus alike, so arXiv could vanish from a
 * search with nothing recording that it had been asked. Errors propagate here
 * so the orchestrator can report a real status.
 *
 * Parsing lives here rather than in `normalize` because it is a transport
 * concern — Atom is how arXiv serialises the feed, not part of its meaning.
 * That keeps `normalize` pure and synchronous over a plain object, and lets
 * the tests read the recorded fixture without going near this file.
 */

const DEFAULT_BASE_URL = 'https://export.arxiv.org/api/query';

export type FetchOptions = {
  baseUrl?: string;
  /** Records per request. Capped by the caller against `capabilities.maxPageSize`. */
  pageSize: number;
  /** Record offset. arXiv pages by record, so this lands exactly. */
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

/** The shape we rely on. Everything else in the feed is passed through untouched. */
export type ArxivFeed = {
  feed?: {
    entry?: unknown[];
    'opensearch:totalResults'?: unknown;
  };
};

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<ArxivFeed> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('arxiv'));

  // The base URL is the whole endpoint, so the request path is empty.
  const response = await client.get<string>('', {
    params: {
      search_query: nativeQuery,
      start: Math.max(offset, 0),
      max_results: pageSize,
      sortBy: 'relevance',
      sortOrder: 'descending'
    },
    timeout: timeoutMs,
    // The feed is XML; letting axios guess invites it to hand back a partly
    // parsed object on a content-type it recognises.
    responseType: 'text',
    ...(signal ? { signal } : {}),
    ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {})
  });

  // The pooled client resolves a 4xx rather than throwing, and the parser
  // below would take an error page as a feed with no entries — a provider
  // saying no, reported as a provider with nothing to say.
  if (response.status >= 400) {
    throw new Error(`arXiv ${response.status}`);
  }

  return parseStringPromise(response.data);
}
