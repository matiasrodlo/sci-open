import type { Paper, ProviderReport, Query, SearchSort } from '@open-access-explorer/shared';
import { PROVIDERS, type ProviderEntry } from './registry';
import { plan } from './plan';
import { fanOut, isComplete } from './fanout';
import { ProviderCache } from './provider-cache';
import { mergePapers } from './merge';
import { rank } from './rank';
import { applyPolicy, type PolicyOptions, type UserFilters } from './policy';
import { generateFacets, type Facets } from './facet';
import { sortPapers } from './sort';

export * from './parse-query';
export { PROVIDERS, plan, fanOut, isComplete, ProviderCache, mergePapers, rank, applyPolicy, generateFacets, sortPapers };

/**
 * plan -> fan out -> merge/dedupe -> rank -> filter -> facet -> paginate
 *
 * The order is load-bearing, not stylistic. Ranking after pagination ranks a
 * page; ranking before dedupe ranks duplicates; faceting before filtering
 * describes a set the caller never sees. Each step here is a pure function
 * except the fan-out, which is the only I/O.
 */

export type SearchOptions = {
  page?: number;
  pageSize?: number;
  /** How deep to read into each provider. Independent of page — see below. */
  depth?: number;
  /** Per-provider budget, owned here rather than by the connectors. */
  timeoutMs?: number;
  filters?: UserFilters;
  /** Replaces the ranked order. `relevance` keeps it. */
  sort?: SearchSort;
  policy?: PolicyOptions;
  /** Passed to providers that support it. Default true, matching prior behaviour. */
  openAccessOnly?: boolean;
  cache?: ProviderCache;
  providers?: readonly ProviderEntry[];
  userAgent?: string;
  now?: () => Date;
};

export type OrchestratorResult = {
  papers: Paper[];
  /** Length of the filtered set, which is what pagination walks. */
  total: number;
  page: number;
  pageSize: number;
  facets: Facets;
  reports: ProviderReport[];
  /**
   * False when a provider failed or timed out, which makes `total` a lower
   * bound rather than an answer.
   */
  complete: boolean;
  duration: number;
};

const DEFAULT_DEPTH = 600;
const DEFAULT_TIMEOUT_MS = 20000;

export async function search(query: Query, options: SearchOptions = {}): Promise<OrchestratorResult> {
  const startedAt = Date.now();
  const {
    page = 1,
    pageSize = 20,
    // Deliberately independent of `page`. Letting depth grow with the page
    // would change the reported total as the user walks through the results,
    // so every page answers from the same window.
    depth = DEFAULT_DEPTH,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    filters = {},
    sort = 'relevance',
    policy = {},
    openAccessOnly = true,
    cache,
    providers = PROVIDERS,
    userAgent,
    now
  } = options;

  const planned = plan(query, providers);

  const { papers: fetched, reports } = await fanOut(planned, {
    query, depth, offset: 0, timeoutMs, openAccessOnly,
    ...(cache ? { cache } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(now ? { now } : {})
  });

  const merged = mergePapers(fetched);
  const ranked = rank(merged, { query, ...(now ? { now: now().getTime() } : {}) }).map(s => s.paper);
  const filtered = applyPolicy(ranked, filters, policy);
  // After filtering so it only orders what will be returned, and before
  // pagination so a page is a slice of the sorted set.
  const sorted = sortPapers(filtered, sort);

  // Facets describe the filtered set, so a bucket count is exactly how far
  // selecting it narrows what is on screen.
  const facets = generateFacets(sorted);

  const start = Math.max(page - 1, 0) * pageSize;

  return {
    papers: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page,
    pageSize,
    facets,
    reports,
    complete: isComplete(reports),
    duration: Date.now() - startedAt
  };
}
