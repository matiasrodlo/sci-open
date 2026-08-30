import axios from 'axios';
import { usableApiKey } from '../../lib/api-key';

/**
 * The only I/O in this provider.
 *
 * The query goes in the path, which is what DOAJ's article search expects. The
 * old connector also passed it as a `q` parameter, where it did nothing.
 */

const DEFAULT_BASE_URL = 'https://doaj.org/api';

/** DOAJ answered, but not with a result page. */
export class DoajUnavailableError extends Error {
  constructor(detail: string) {
    super(`DOAJ returned no search response: ${detail}`);
    this.name = 'DoajUnavailableError';
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

export type DoajPayload = {
  total?: number;
  results?: unknown[];
};

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<DoajPayload> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    pageSize,
    offset,
    timeoutMs,
    signal,
    userAgent
  } = options;

  // DOAJ happens to ignore an unrecognised bearer token where DataCite answers
  // 401, but sending a placeholder as a credential is wrong either way.
  const key = usableApiKey(apiKey);

  const response = await axios.get<DoajPayload>(
    `${baseUrl}/search/articles/${encodeURIComponent(nativeQuery)}`,
    {
      params: {
        pageSize,
        // Pages are 1-based, so an offset lands exactly on page boundaries.
        page: Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1
        // No `sort`. DOAJ's default is relevance; the old connector forced
        // `created_date:desc`, so it contributed its newest articles rather
        // than its best matches — measured, the default returns a mix of 2021,
        // 2022 and 2024 where the forced sort returns 2026 three times.
        // `SourceRef.rank` feeds rank fusion, so a date ordering there is not a
        // relevance ordering at all.
      },
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      ...(signal ? { signal } : {})
    }
  );

  const payload = response.data ?? {};

  // A 200 is not on its own an answer. A search that genuinely matched nothing
  // still returns `results: []` alongside a total.
  if (!Array.isArray(payload.results)) {
    throw new DoajUnavailableError(
      `body carried ${Object.keys(payload).join(', ') || 'nothing'} (HTTP ${response.status})`
    );
  }

  return payload;
}
