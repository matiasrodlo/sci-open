import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';

/** The only I/O in this provider. */

const DEFAULT_BASE_URL = 'https://api.plos.org/search';

/**
 * Fields asked for. `subject` is the addition: the old connector left it out
 * of the list and then had nothing to put in `topics`, so it fell back to the
 * article type.
 */
const FIELDS =
  'id,title,title_display,author,author_display,abstract,publication_date,journal,article_type,subject,doi,score';

/**
 * Research output only. Corrections and retractions are real documents but
 * they are not what a literature search is for.
 */
const ARTICLE_TYPES =
  'article_type:"Research Article" OR article_type:"Meta-Analysis" OR article_type:"Systematic Review"';

export class PlosUnavailableError extends Error {
  constructor(detail: string) {
    super(`PLOS returned no search response: ${detail}`);
    this.name = 'PlosUnavailableError';
  }
}

export type FetchOptions = {
  baseUrl?: string;
  pageSize: number;
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type PlosPayload = {
  response?: { numFound?: number; start?: number; docs?: unknown[] };
};

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<PlosPayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('plos'));

  // The base URL is the whole endpoint, so the request path is empty; axios
  // returns the base unchanged for a falsy relative URL.
  const response = await client.get<PlosPayload>('', {
    params: {
      q: nativeQuery,
      rows: pageSize,
      start: Math.max(offset, 0),
      wt: 'json',
      fl: FIELDS,
      fq: ARTICLE_TYPES
    },
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  });

  if (response.status >= 400) {
    throw new PlosUnavailableError(`HTTP ${response.status}`);
  }

  const payload = response.data ?? {};

  // A search that matched nothing still returns a `docs` array.
  if (!Array.isArray(payload.response?.docs)) {
    throw new PlosUnavailableError(`body carried no docs array (HTTP ${response.status})`);
  }

  return payload;
}
