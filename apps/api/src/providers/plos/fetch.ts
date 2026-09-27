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

export type FacetFetchOptions = Omit<FetchOptions, 'pageSize' | 'offset'> & {
  /** Count by journal. */
  journals?: boolean;
  /** Count by publication year, for these years. */
  years?: readonly number[];
};

export type PlosFacetPayload = {
  response?: { numFound?: number };
  facet_counts?: {
    facet_fields?: { journal?: unknown[] };
    facet_ranges?: { publication_date?: { counts?: unknown[] } };
  };
};

/**
 * Counts for a query across the whole index, from Solr's own facets — no
 * records, one request.
 *
 * The same `fq` as `fetchPage`, which is what makes the counts describe the
 * set a search reads from; without it they would include corrections and
 * issue images. Years are a range facet over `publication_date`, a date field,
 * one bucket per calendar year.
 */
export async function fetchFacets(nativeQuery: string, options: FacetFetchOptions): Promise<PlosFacetPayload> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent, journals = false, years = [] } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('plos'));

  const params = new URLSearchParams({ q: nativeQuery, rows: '0', wt: 'json', fq: ARTICLE_TYPES });
  if (journals || years.length > 0) {
    params.set('facet', 'true');
    params.set('facet.mincount', '1');
  }
  if (journals) {
    params.append('facet.field', 'journal');
    params.set('f.journal.facet.limit', '25');
  }
  if (years.length > 0) {
    params.append('facet.range', 'publication_date');
    params.set('facet.range.start', `${Math.min(...years)}-01-01T00:00:00Z`);
    params.set('facet.range.end', `${Math.max(...years) + 1}-01-01T00:00:00Z`);
    params.set('facet.range.gap', '+1YEAR');
  }

  const response = await client.get<PlosFacetPayload>('', {
    params,
    timeout: timeoutMs,
    headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    ...(signal ? { signal } : {})
  });

  if (response.status >= 400) {
    throw new PlosUnavailableError(`HTTP ${response.status}`);
  }

  const payload = response.data ?? {};
  if (typeof payload.response?.numFound !== 'number') {
    throw new PlosUnavailableError(`a facet response carrying no numFound (HTTP ${response.status})`);
  }

  return payload;
}
