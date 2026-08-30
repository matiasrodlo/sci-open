import type { AxiosInstance } from 'axios';
import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { extractContactEmail } from '../../lib/contact-email';
import type { OpenAlexParams } from './translate';

/**
 * The only I/O in this provider.
 *
 * The fields asked for are the whole of what `normalize` reads. Two the old
 * path could not have used are worth naming: `host_venue` is **not a valid
 * select field** — OpenAlex answers `select=host_venue` with HTTP 400, so the
 * publisher it tried to read from there was never going to arrive — and
 * `created_date` is the date OpenAlex minted the record, not a publication
 * date, so it is not requested at all. The publication date is
 * `publication_year`.
 */

const DEFAULT_BASE_URL = 'https://api.openalex.org';

const SELECT = [
  'id',
  'doi',
  'title',
  'display_name',
  'authorships',
  'publication_year',
  'primary_location',
  'best_oa_location',
  'abstract_inverted_index',
  'topics',
  'keywords',
  'open_access',
  'cited_by_count',
  'type',
  'language'
].join(',');

/**
 * OpenAlex answered, but not with a page of works.
 *
 * The pooled client sets `validateStatus: status < 500`, so a 429 or a 400
 * resolves as a success carrying an error object. Both happen in practice: the
 * daily budget runs out, and the old path's year filter was rejected outright.
 */
export class OpenAlexUnavailableError extends Error {
  readonly status: number;
  /** Seconds until the quota resets, when OpenAlex says so. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, detail: string, retryAfterSeconds?: number) {
    super(`OpenAlex ${status}: ${detail}`);
    this.name = 'OpenAlexUnavailableError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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

export type OpenAlexPayload = {
  results?: unknown[];
  meta?: { count?: number };
};

export async function fetchPage(
  params: OpenAlexParams,
  options: FetchOptions
): Promise<OpenAlexPayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;

  const client: AxiosInstance = getPooledClient(baseUrl, getServiceConfig('openalex'));

  // OpenAlex routes callers who identify themselves into a faster pool. It
  // reads either the User-Agent or a `mailto`; sending both is the documented
  // polite path.
  const contactEmail = userAgent ? extractContactEmail(userAgent) : undefined;

  const response = await client.get<OpenAlexPayload>('/works', {
    params: {
      ...params,
      per_page: pageSize,
      // Pages are 1-based, so an offset lands exactly on page boundaries.
      page: Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1,
      select: SELECT,
      ...(contactEmail ? { mailto: contactEmail } : {})
    },
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  });

  const body = response.data as Record<string, unknown> | undefined;

  if (response.status >= 400) {
    const detail =
      typeof body?.message === 'string' ? body.message
      : typeof body?.error === 'string' ? body.error
      : response.statusText || 'no message given';
    const retryAfter = typeof body?.retryAfter === 'number' ? body.retryAfter : undefined;
    throw new OpenAlexUnavailableError(response.status, detail, retryAfter);
  }

  // A 2xx is not enough on its own: the shape is what the caller depends on,
  // and a search that matched nothing still returns an empty `results` array.
  if (!Array.isArray(body?.results)) {
    throw new OpenAlexUnavailableError(response.status, 'a 2xx response carrying no results array');
  }

  return response.data;
}
