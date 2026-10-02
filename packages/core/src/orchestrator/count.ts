import type { ProviderReport, SearchParams } from '@open-access-explorer/shared';
import { plan } from './plan';
import { fanOut, isComplete } from './fanout';
import { queryOf } from './from-search-params';
import type { ProviderCache } from './provider-cache';
import type { ProviderEntry } from './registry';
import { progressTo, type SearchProgress } from './progress';

/** One record is the whole of a count: the provider's total comes with it. */
const COUNT_DEPTH = 1;
/** One request per source, where a search's budget covers several pages. */
const COUNT_TIMEOUT_MS = 10_000;

export type CountOptions = {
  providers: readonly ProviderEntry[];
  cache?: ProviderCache;
  userAgent?: string;
  /** Asked once before any source is; may throw to refuse the count. */
  admit?: () => Promise<void>;
  /** Each source as it settles, as a search reports them. */
  onProgress?: (event: SearchProgress) => void;
};

export type CountOutcome = {
  /** One per provider, shaped as a search reports them; `totalHits` is the count. */
  reports: ProviderReport[];
  /** False when a source that reports counts did not answer. */
  complete: boolean;
};

/**
 * Each source's own count of what a search's params match, without reading the
 * matches.
 *
 * An agent tuning a query needs "about how many": too many, narrow a concept;
 * too few, add synonyms. A search answers that by reading `depth` records from
 * every source, merging them, applying the full query and asking Unpaywall
 * about the papers the access gate would drop — up to half a minute. This asks
 * every planned source for one record and keeps the count that comes with it:
 * a request a source, or two where its API lists ids before it serves a record
 * (PubMed, Europe PMC), and no merge, check, ranking or enrichment.
 *
 * The numbers are the sources', not this service's. Each source counts the
 * query as it could express it — wider where it could not express a clause —
 * and before duplicates, the full-query check and the access gate. They compare
 * variants of a query. They are not the total its search would report, and
 * they are never summed (see `ProviderReport.totalHits`).
 */
export async function countSearch(params: SearchParams, options: CountOptions): Promise<CountOutcome> {
  const { query, openAccessOnly } = queryOf(params);

  // A year range that ends before it starts matches nothing anywhere, and a
  // search answers it without asking anyone (`emptyYears`); so does a count.
  const { from, to } = query.years ?? {};
  if (from !== undefined && to !== undefined && from > to) {
    return {
      reports: options.providers.map(p => ({
        provider: p.id, status: 'skipped', retrieved: 0, latency: 0, skipReason: 'the year range ends before it starts'
      })),
      complete: true
    };
  }

  // A source that reports no total would spend a request to say nothing.
  const counting = options.providers.filter(p => p.capabilities.reportsTotal);
  const silent: ProviderReport[] = options.providers
    .filter(p => !p.capabilities.reportsTotal)
    .map(p => ({ provider: p.id, status: 'skipped', retrieved: 0, latency: 0, skipReason: 'reports no match count' }));

  await options.admit?.();
  const planned = plan(query, counting);
  const progress = progressTo(options.onProgress);
  let settled = 0;
  const { reports } = await fanOut(planned, {
    query, depth: COUNT_DEPTH, offset: 0, timeoutMs: COUNT_TIMEOUT_MS, openAccessOnly,
    onSettled: ({ report }) => progress({ stage: 'sources', settled: ++settled, planned: planned.planned.length, report }),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {})
  });
  return { reports: [...reports, ...silent], complete: isComplete(reports) };
}
