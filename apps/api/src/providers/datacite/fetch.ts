import type { AxiosInstance } from 'axios';
import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';

/** The only I/O in this provider. */

const DEFAULT_BASE_URL = 'https://api.datacite.org/dois';

export class DataCiteUnavailableError extends Error {
  constructor(detail: string) {
    super(`DataCite returned no search response: ${detail}`);
    this.name = 'DataCiteUnavailableError';
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

export type DataCitePayload = { data?: unknown[]; meta?: { total?: number } };

export async function fetchPage(
  nativeQuery: string,
  options: FetchOptions
): Promise<DataCitePayload> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    pageSize,
    offset,
    timeoutMs,
    signal,
    userAgent
  } = options;

  const client: AxiosInstance = getPooledClient(baseUrl, getServiceConfig('datacite'));

  const response = await client.get<DataCitePayload>('', {
    params: {
      query: nativeQuery,
      'page[size]': pageSize,
      // Pages are 1-based, so an offset lands exactly on page boundaries.
      'page[number]': Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1
    },
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    ...(signal ? { signal } : {})
  });

  // The pooled client resolves anything below 500, so a rejected or
  // rate-limited request arrives as a normal response with an error body.
  if (!Array.isArray(response.data?.data)) {
    throw new DataCiteUnavailableError(`no data array (HTTP ${response.status})`);
  }

  return response.data;
}
