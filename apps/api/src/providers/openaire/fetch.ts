import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import type { OpenAireParams } from './translate';

/** The only I/O in this provider. */

const DEFAULT_BASE_URL = 'https://api.openaire.eu/search';

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
  response?: {
    header?: { total?: unknown };
    results?: { result?: unknown };
  };
};

export async function fetchPage(
  params: OpenAireParams,
  options: FetchOptions
): Promise<OpenAirePayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('openaire'));

  const response = await client.get<OpenAirePayload>('/publications', {
    params: {
      ...params,
      size: pageSize,
      // Pages are 1-based, so an offset lands exactly on page boundaries.
      page: Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1
    },
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  });

  if (response.status >= 400) {
    throw new OpenAireUnavailableError(`HTTP ${response.status}`);
  }

  const payload = response.data ?? {};

  // A 200 is not on its own an answer: a search that matched nothing still
  // carries a `response` with a header and a total.
  if (!payload.response?.header) {
    throw new OpenAireUnavailableError(`body carried no response header (HTTP ${response.status})`);
  }

  return payload;
}
