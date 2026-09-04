import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, toParams, type TranslateOptions } from './translate';
import { fetchPage, OpenAireUnavailableError, type FetchOptions } from './fetch';
import { normalize, totalHits, type SkippedRecord } from './normalize';
import { readPages } from '../read-pages';
import { log } from '../../lib/logger';

export { capabilities, translate, toParams, fetchPage, normalize, totalHits, OpenAireUnavailableError };
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
  if (!params.keywords && !params.doi) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();

  // OpenAIRE serves at most 100 per page and the orchestrator asks for `depth`
  // — 600 by default — so a single page returned a sixth of what was requested
  // and reported it as a complete read. See `providers/read-pages.ts`.
  //
  // Worth knowing operationally: an OpenAIRE record is around 12 KB of JSON, so
  // a full six-page read is roughly 7 MB on the wire where one page was 1.2 MB.
  // The page count is bounded by what the corpus actually holds, so only a
  // query with more than 500 matches pays it.
  const { items, total, requests } = await readPages({
    wanted: pageSize,
    perPage: capabilities.maxPageSize,
    offset,
    fetch: page => fetchPage(params, { ...fetchOptions, ...page }),
    itemsOf: payload => asArray(payload?.response?.results?.result),
    totalOf: totalHits
  });

  const latency = Date.now() - started;

  // Rebuilt as the one payload `normalize` reads, which is what keeps this
  // module the only place that knows a read was ever more than one request.
  const { papers, skipped } = normalize(
    { response: { results: { result: items } } },
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

/**
 * OpenAIRE returns a single-element list as a bare object rather than an array,
 * so a one-record page has to be wrapped before pages can be concatenated.
 * `normalize` has its own copy of this for the payload it is handed; this one
 * is for taking records back out.
 */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export type LookupOptions = Omit<FetchOptions, 'pageSize' | 'offset'> & { now?: () => Date };

/**
 * One paper by its OpenAIRE `objIdentifier`.
 *
 * Verified live 2026-08-30 on `doi_dedup___::e102f905c7609789b70634cf0ecde7cd`:
 * `total` is 1 and the record's own objIdentifier is the one asked for. The
 * match is checked here regardless, because the parameter's query expansion
 * also matches on `resultdupid` — a deduplicated sibling would come back under
 * a different id, and that is a different record.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchPage(
    { openairePublicationID: nativeId, format: 'json' },
    { ...fetchOptions, pageSize: 1, offset: 0 }
  );
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers.find(paper => paper.sources[0]?.nativeId === nativeId) ?? null;
}
