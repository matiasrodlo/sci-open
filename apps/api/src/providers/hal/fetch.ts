import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { STAGES } from './normalize';

/** The only I/O in this provider. */

const DEFAULT_BASE_URL = 'https://api.archives-ouvertes.fr/search/';

/** What `normalize` reads, and nothing else: a record's `_s` fields are many. */
const FIELDS = [
  'halId_s',
  'uri_s',
  'doiId_s',
  'title_s',
  'abstract_s',
  'authFullName_s',
  'producedDateY_i',
  'docType_s',
  'journalTitle_s',
  'conferenceTitle_s',
  'bookTitle_s',
  'journalPublisher_s',
  'publisher_s',
  'keyword_s',
  'language_s',
  'fileMain_s',
  'openAccess_bool'
].join(',');

/**
 * What every request reads from: deposits whose file HAL serves openly, of the
 * types `STAGES` names. Measured over all of HAL on 2026-10-01:
 *
 * - `submitType_s:file` — 1,803,275 deposits carry a file. The rest are
 *   notices, references to a paper held elsewhere, and a notice is what every
 *   other provider in the fan-out already returns.
 * - `openAccess_bool:true` — 13,662 of those files are under embargo, and an
 *   embargoed file's `fileMain_s` answers HTTP 403. Two were checked.
 * - `docType_s` — the six types in `STAGES`. No thesis: see there.
 * - not `docSubType_s:DMP` — 225 data management plans, filed as reports.
 *
 * 1,346,476 records in all. A filter query rather than part of `q`, so it is
 * the same on every request and Solr caches it.
 */
const READ = [
  'submitType_s:file',
  'openAccess_bool:true',
  `docType_s:(${Object.keys(STAGES).join(' OR ')})`,
  'NOT docSubType_s:DMP'
].join(' AND ');

/**
 * HAL answered, but not with a result page.
 *
 * `status` is the HTTP status when the failure was one. HAL answers a query
 * its parser refuses with **200** and `{"error":{"msg":"Error. See help :
 * /docs"}}` — the same message whatever the fault — so that case carries no
 * status, and the fan-out counts it as a failure to answer rather than a
 * refusal. `translate` escapes what HAL's parser refuses, so it should not
 * arise; if it does, being wrong on that side costs a repeated request.
 */
export class HalUnavailableError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status?: number) {
    super(`HAL returned no search response: ${detail}`);
    this.name = 'HalUnavailableError';
    this.status = status;
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

export type HalPayload = {
  response?: { numFound?: number; start?: number; docs?: unknown[] };
  error?: { msg?: string };
};

type RequestOptions = Pick<FetchOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'userAgent'>;

async function request<T extends { error?: { msg?: string } }>(params: URLSearchParams, options: RequestOptions): Promise<T> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;
  const client = getPooledClient(baseUrl, getServiceConfig('hal'));

  // The base URL is the whole endpoint, so the request path is empty; axios
  // returns the base unchanged for a falsy relative URL.
  const response = await client.get<T>('', {
    params,
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  });

  if (response.status >= 400) {
    throw new HalUnavailableError(`HTTP ${response.status}`, response.status);
  }

  const payload = (response.data ?? {}) as T;
  if (payload.error) {
    throw new HalUnavailableError(`an error body, "${String(payload.error.msg ?? '').slice(0, 120)}"`);
  }
  return payload;
}

function searchParams(nativeQuery: string): URLSearchParams {
  return new URLSearchParams({ q: nativeQuery, fq: READ, wt: 'json' });
}

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<HalPayload> {
  const { pageSize, offset, ...rest } = options;

  const params = searchParams(nativeQuery);
  params.set('fl', FIELDS);
  params.set('rows', String(pageSize));
  params.set('start', String(Math.max(offset, 0)));

  const payload = await request<HalPayload>(params, rest);

  // A search that matched nothing still returns a `docs` array.
  if (!Array.isArray(payload.response?.docs)) {
    throw new HalUnavailableError('body carried no docs array');
  }

  return payload;
}

/** The fields each counted facet is read from. */
export const FACET_FIELDS = {
  year: 'producedDateY_i',
  stage: 'docType_s',
  venue: 'journalTitle_s',
  publisher: 'journalPublisher_s'
} as const;

export type FacetField = (typeof FACET_FIELDS)[keyof typeof FACET_FIELDS];

export type FacetFetchOptions = RequestOptions & {
  /** The fields to count by. */
  fields: readonly FacetField[];
};

export type HalFacetPayload = {
  response?: { numFound?: number };
  facet_counts?: { facet_fields?: Partial<Record<FacetField, unknown[]>> };
  error?: { msg?: string };
};

/**
 * Counts for a query across everything HAL reads from, from Solr's own facets
 * — no records, one request for every field asked.
 *
 * The same filter as `fetchPage`, which is what makes the counts describe the
 * set a search reads from. Years and types are few and counted whole; venues
 * and publishers are the 25 largest, as on PLOS.
 */
export async function fetchFacets(nativeQuery: string, options: FacetFetchOptions): Promise<HalFacetPayload> {
  const { fields, ...rest } = options;

  const params = searchParams(nativeQuery);
  params.set('rows', '0');
  if (fields.length > 0) {
    params.set('facet', 'true');
    params.set('facet.mincount', '1');
  }
  for (const field of fields) {
    params.append('facet.field', field);
    const open = field === FACET_FIELDS.year || field === FACET_FIELDS.stage;
    params.set(`f.${field}.facet.limit`, open ? '-1' : '25');
  }

  const payload = await request<HalFacetPayload>(params, rest);
  if (typeof payload.response?.numFound !== 'number') {
    throw new HalUnavailableError('a facet response carrying no numFound');
  }

  return payload;
}
