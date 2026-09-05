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

/** Options for a request that names its records rather than searching for them. */
export type RecordFetchOptions = Omit<FetchOptions, 'pageSize' | 'offset'>;

/** The one request both entry points make, differing only in what they ask for. */
async function get(
  params: Record<string, string | number>,
  options: RecordFetchOptions
): Promise<ArxivFeed> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('arxiv'));

  // The base URL is the whole endpoint, so the request path is empty.
  const response = await client.get<string>('', {
    params,
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

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<ArxivFeed> {
  const { pageSize, offset, ...rest } = options;

  return get(
    {
      search_query: nativeQuery,
      start: Math.max(offset, 0),
      max_results: pageSize,
      sortBy: 'relevance',
      sortOrder: 'descending'
    },
    rest
  );
}

/**
 * One record, named rather than searched for.
 *
 * `id_list` is a different parameter from `search_query`, not a query written
 * in a different way, which is why this is a second entry point rather than
 * something `translate` could express. An arXiv identifier appears in no
 * searchable field — `(ti:1706.03762 OR abs:1706.03762 OR …)`, which is what
 * routing a native id through `translate` produces, matches nothing — so the
 * paper endpoint answered 404 for every arXiv record before this existed.
 *
 * A versioned id round-trips exactly: `id_list=1706.03762v7` comes back as
 * `http://arxiv.org/abs/1706.03762v7`, which matters because `normalize` keeps
 * the version in `nativeId` and `lookupPaper` compares the two. An id nobody
 * has yields a feed with no entries, and a malformed one an error entry whose
 * id is not the one asked for — rejected by that same comparison.
 */
export async function fetchRecord(
  nativeId: string,
  options: RecordFetchOptions
): Promise<ArxivFeed> {
  return get({ id_list: nativeId, max_results: 1 }, options);
}
