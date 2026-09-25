import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import {
  fetchPage, fetchArticle, DoajUnavailableError,
  type FetchOptions, type ArticleFetchOptions
} from './fetch';
import { normalize, type SkippedRecord } from './normalize';
import { readPages } from '../read-pages';
import { countFacets, type Pace, type ProviderFacetArgs, type ProviderFacetOutcome } from '../count-facets';
import { log } from '../../lib/logger';

export { capabilities, translate, fetchPage, fetchArticle, normalize, DoajUnavailableError };
export type { TranslateOptions, FetchOptions, ArticleFetchOptions, SkippedRecord };

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
  const {
    openAccessOnly,
    pageSize = 50,
    offset = 0,
    now = () => new Date(),
    ...fetchOptions
  } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();

  // DOAJ caps a page at 100 and the orchestrator asks for `depth` — 600 by
  // default — so a single page returned a sixth of what was requested and
  // reported it as a complete read. See `providers/read-pages.ts`.
  const { items, total, requests } = await readPages({
    wanted: pageSize,
    perPage: capabilities.maxPageSize,
    offset,
    fetch: page => fetchPage(nativeQuery, { ...fetchOptions, ...page }),
    itemsOf: payload => payload?.results ?? [],
    totalOf: payload => (Number.isFinite(Number(payload?.total)) ? Number(payload.total) : undefined)
  });

  const latency = Date.now() - started;

  // Rebuilt as the one payload `normalize` reads, which is what keeps this
  // module the only place that knows a read was ever more than one request.
  const { papers, skipped } = normalize({ results: items }, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  log.debug('DOAJ read', { requests, retrieved: papers.length, wanted: pageSize });

  return {
    papers,
    ...(total !== undefined ? { totalHits: total } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = ArticleFetchOptions & { now?: () => Date };

/** One paper by its DOAJ article id. */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchArticle(nativeId, fetchOptions);
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers[0] ?? null;
}

export type CountOptions = TranslateOptions & Omit<FetchOptions, 'pageSize' | 'offset'>;

/** DOAJ's count for a query, from a one-record page's `total`. */
export async function count(query: Query, options: CountOptions): Promise<number> {
  const { openAccessOnly, ...fetchOptions } = options;
  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return 0;
  const payload = await fetchPage(nativeQuery, { ...fetchOptions, pageSize: 1, offset: 0 });
  const total = Number(payload?.total);
  if (!Number.isFinite(total)) throw new DoajUnavailableError('a count carrying no total');
  return total;
}

/**
 * DOAJ enforces a rate: ten counts in one burst drew a 429 on 2026-09-25, and
 * the search has just sent it six pages. Four at once, then two a second.
 */
const PACE: Pace = { burst: 4, perSecond: 2 };

/** Year and stage counts across everything DOAJ matches. See `count-facets.ts`. */
export function facets(args: ProviderFacetArgs, options: { apiKey?: string } = {}): Promise<ProviderFacetOutcome> {
  return countFacets(args, {
    holds: capabilities.stages.holds,
    translate: query => translate(query, { openAccessOnly: args.openAccessOnly }),
    count: query => count(query, {
      openAccessOnly: args.openAccessOnly,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    timeoutMs: args.timeoutMs,
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.userAgent ? { userAgent: args.userAgent } : {})
    }),
    pace: PACE,
    ...(args.signal ? { signal: args.signal } : {})
  });
}
