import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { usableApiKey } from '../../lib/api-key';
import type { CorePayload } from './normalize';

/**
 * The only I/O in this provider.
 *
 * The trailing slash is load-bearing: `/v3/search/works` answers 301 to
 * `/v3/search/works/`, and a redirect that is followed inconsistently is not
 * worth relying on.
 */

const DEFAULT_BASE_URL = 'https://api.core.ac.uk/v3';

/** CORE answered, but not with a result page. */
export class CoreUnavailableError extends Error {
  constructor(detail: string) {
    super(`CORE returned no search response: ${detail}`);
    this.name = 'CoreUnavailableError';
  }
}

export type FetchOptions = {
  baseUrl?: string;
  apiKey?: string;
  pageSize: number;
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<CorePayload> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    pageSize,
    offset,
    timeoutMs,
    signal,
    userAgent
  } = options;

  // An unconfigured key must not be sent: CORE answers a bad one with 401 in
  // under a second, where no header at all answers 200.
  const key = usableApiKey(apiKey);

  const client = getPooledClient(baseUrl, getServiceConfig('core'));

  const response = await client.get<CorePayload>('/search/works/', {
    params: {
      q: nativeQuery,
      limit: pageSize,
      offset: Math.max(offset, 0)
    },
    timeout: timeoutMs,
    headers: {
      Accept: 'application/json',
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {})
    },
    ...(signal ? { signal } : {})
  });

  // Read rather than thrown: the pooled client resolves a 4xx. A bad key
  // answers 401 here, and reporting that as "body carried nothing" would name
  // the wrong cause.
  if (response.status >= 400) {
    throw new CoreUnavailableError(`HTTP ${response.status}`);
  }

  const payload = response.data ?? {};

  // A search that matched nothing still returns a `results` array.
  if (!Array.isArray(payload.results)) {
    throw new CoreUnavailableError(
      `body carried ${Object.keys(payload).join(', ') || 'nothing'} (HTTP ${response.status})`
    );
  }

  return payload;
}
