import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, toParams, type TranslateOptions } from './translate';
import { fetchPage, fetchProduct, OpenAireUnavailableError, type FetchOptions } from './fetch';
import { normalize, normalizeRecord, totalHits, type SkippedRecord } from './normalize';
import { readPages } from '../read-pages';
import { log } from '../../lib/logger';

export { capabilities, translate, toParams, fetchPage, fetchProduct, normalize, totalHits, OpenAireUnavailableError };
export type { TranslateOptions, FetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  totalHits?: number;
  skipped: SkippedRecord[];
  latency: number;
};

export async function search(query: Query, options: SearchOptions): Promise<ProviderSearchResult> {
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const params = toParams(query, { openAccessOnly });
  if (!params.search && !params.pid) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();

  // OpenAIRE serves at most 100 per page and the orchestrator asks for `depth`
  // — 600 by default — so a single page returned a sixth of what was requested
  // and reported it as a complete read. See `providers/read-pages.ts`.
  //
  // Worth knowing operationally: a Graph API record is around 5.5 KB of JSON,
  // so a full six-page read is roughly 3.5 MB. The legacy endpoint served
  // ~77 KB a record and could not finish that read inside the fan-out budget —
  // see `fetch.ts`. The page count is bounded by what the corpus actually
  // holds, so only a query with more than 500 matches pays it.
  const { items, total, requests } = await readPages({
    wanted: pageSize,
    perPage: capabilities.maxPageSize,
    offset,
    fetch: page => fetchPage(params, { ...fetchOptions, ...page }),
    itemsOf: payload => (Array.isArray(payload?.results) ? payload.results : []),
    totalOf: totalHits
  });

  const latency = Date.now() - started;

  // Rebuilt as the one payload `normalize` reads, which is what keeps this
  // module the only place that knows a read was ever more than one request.
  const { papers, skipped } = normalize(
    { results: items },
    { retrievedAt: now().toISOString(), rankOffset: offset, latency }
  );

  log.debug('OpenAIRE read', { requests, retrieved: papers.length, wanted: pageSize });

  return {
    papers,
    ...(total !== undefined ? { totalHits: total } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = Omit<FetchOptions, 'pageSize' | 'offset'> & { now?: () => Date };

/**
 * One paper by its OpenAIRE id.
 *
 * `GET /researchProducts/{id}` on the Graph API; an unknown id is a 404, which
 * `fetchProduct` answers as `null`. The legacy endpoint needed
 * `openairePublicationID`, whose query expansion also matched on
 * `resultdupid`, so a deduplicated sibling could come back under a different
 * id. The match is still checked here, because a different record is not this
 * one whichever endpoint returned it.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const record = await fetchProduct(nativeId, fetchOptions);
  const latency = Date.now() - started;
  if (!record) return null;

  const { papers } = normalizeRecord(record, { retrievedAt: now().toISOString(), latency });
  return papers.find(paper => paper.sources[0]?.nativeId === nativeId) ?? null;
}
