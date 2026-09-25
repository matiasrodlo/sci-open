import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import type { OpenAireParams } from './translate';

/** The only I/O in this provider. */

/**
 * The Graph API, not the legacy `/search/publications` endpoint.
 *
 * Both answer from the same graph, and the legacy one was too heavy to read at
 * the orchestrator's depth inside its budget. Measured 2026-09-25 on
 * `zebrafish fin regeneration`, open access only, six pages of 100:
 *
 * - legacy: 8.6–11.7 MB a page, ~77 KB a record, served uncompressed whatever
 *   the request asks for. Two thirds of each record is `children` and `rels` —
 *   every duplicate instance and every linked project and dataset — which
 *   nothing here reads. The first page took 7.9 s and the five after it up to
 *   29 s more, 37 s in all, against a fan-out budget of 20 s. Two of five
 *   searches that session got OpenAIRE's answer inside the budget; the rest
 *   reported it as not answering, and a search missing a provider is not
 *   cached, so the next one paid the same read again.
 * - Graph: ~0.6 MB a page, ~5.5 KB a record. All six pages in 2.3 s.
 *
 * Same 606 matches from each, and the same 600 ids in the read, so a paper id
 * handed out by either — `openaire:doi_dedup___::…` — names the same record.
 */
const DEFAULT_BASE_URL = 'https://api.openaire.eu/graph/v1';

export class OpenAireUnavailableError extends Error {
  constructor(detail: string) {
    super(`OpenAIRE returned no search response: ${detail}`);
    this.name = 'OpenAireUnavailableError';
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

export type OpenAirePayload = {
  header?: { numFound?: unknown };
  results?: unknown;
};

function requestConfig(options: Omit<FetchOptions, 'pageSize' | 'offset'>) {
  const { timeoutMs, signal, userAgent } = options;
  return {
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  };
}

export async function fetchPage(
  params: OpenAireParams,
  options: FetchOptions
): Promise<OpenAirePayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('openaire'));

  const response = await client.get<OpenAirePayload>('/researchProducts', {
    params: {
      ...params,
      pageSize,
      // Pages are 1-based, so an offset lands exactly on page boundaries.
      page: Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1
    },
    ...requestConfig(options)
  });

  if (response.status >= 400) {
    throw new OpenAireUnavailableError(`HTTP ${response.status}`);
  }

  const payload = response.data ?? {};

  // A 200 is not on its own an answer: a search that matched nothing still
  // carries a header with `numFound: 0` and an empty `results`.
  if (!payload.header) {
    throw new OpenAireUnavailableError(`body carried no response header (HTTP ${response.status})`);
  }

  return payload;
}

/**
 * One research product by its OpenAIRE id, or `null` when OpenAIRE has none.
 *
 * A path parameter, where the legacy endpoint needed `openairePublicationID`.
 * An unknown id answers HTTP 404 with an error body, which the pooled client
 * resolves rather than throws — so it is read from the status here.
 */
export async function fetchProduct(
  id: string,
  options: Omit<FetchOptions, 'pageSize' | 'offset'>
): Promise<unknown | null> {
  const { baseUrl = DEFAULT_BASE_URL } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('openaire'));

  const response = await client.get<unknown>(
    `/researchProducts/${encodeURIComponent(id)}`,
    requestConfig(options)
  );

  if (response.status === 404) return null;
  if (response.status >= 400) {
    throw new OpenAireUnavailableError(`HTTP ${response.status}`);
  }

  return response.data ?? null;
}
