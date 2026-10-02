import type { CountedFacet, ProviderId, Query, SourceFacets } from '@open-access-explorer/shared';
import { plan } from './plan';
import { withBudget, type ProviderSettled } from './fanout';
import { generateFacets, type SourceCounts } from './facet';
import type { FacetRequest, ProviderEntry, ProviderFacetOutcome } from './registry';
import type { ProviderCache } from './provider-cache';

/**
 * Facet counts across everything each source matches, rather than across the
 * part of it this search read.
 *
 * The facet panel used to count the read — the top `depth` records of each
 * source, merged — so its numbers described the top of the answer and moved
 * with how deep it was read and how many sources answered. On `ai` it said 964
 * papers from 2026; OpenAlex alone holds 424,757. A reader using the panel to
 * see how much work there is on a topic, and where it sits, was shown the size
 * of our read instead.
 *
 * Every source is asked what it can answer. Two aggregate natively — OpenAlex
 * through `group_by`, PLOS through Solr's facets — and answer each facet in a
 * request. The rest report a total and nothing finer, so each bucket is a count
 * of a narrower query: a year is the query bounded to that year, a stage the
 * query narrowed to that stage. See `providers/count-facets.ts`.
 *
 * The counts are combined in `withSourceCounts`, by taking the largest single
 * source's count for each value and never the sum.
 */

/**
 * The query each facet is counted under — and, by being present, the facets
 * that can be counted across the sources at all.
 *
 * Built at the request boundary (`from-search-params.ts`), because only there
 * is it known which ticked filters were sent to the sources and which were only
 * applied to what came back. A facet is counted with its own selection lifted,
 * as the read's facets are (see `facetBaseSets`), so the year facet's query is
 * the search without the ticked years. A facet is absent when some *other*
 * ticked filter could not be sent: every source's count would then be of a set
 * the reader has already narrowed away from, and the read is the only count
 * true of the question.
 */
export type FacetQueries = Partial<Record<CountedFacet, Query>>;

/** How many years a count-by-count source is asked about. The panel shows ten. */
export const YEAR_BUCKETS = 10;

/**
 * The years to count, newest first: the ten up to the current year, inside
 * whatever bound the year facet's query carries. A source that aggregates
 * counts every year at once and uses this, at most, as its range.
 */
export function yearWindow(query: Query | undefined, now: Date, size = YEAR_BUCKETS): number[] {
  const current = now.getUTCFullYear();
  const to = Math.min(query?.years?.to ?? current, current);
  const from = Math.max(query?.years?.from ?? Number.NEGATIVE_INFINITY, to - size + 1);

  const years: number[] = [];
  for (let year = to; year >= from; year--) years.push(year);
  return years;
}

export type SourceFacetsOptions = {
  queries: FacetQueries;
  /** The query the search itself was sent, to recognise a facet asked under the same one. */
  searched: Query;
  /**
   * Resolves when a provider's search settles, with what it returned; to
   * `undefined` for a provider that was not searched.
   */
  settled: (provider: ProviderId) => Promise<ProviderSettled | undefined>;
  openAccessOnly: boolean;
  /** Wall clock for all of it, from the moment this is called. */
  budgetMs: number;
  cache?: ProviderCache;
  userAgent?: string;
  now?: () => Date;
};

export type SourceFacetsResult = SourceCounts & {
  /** Why some or all of its counts are missing. See `ProviderReport.facetError`. */
  error?: string;
};

/** Whether this provider would be asked this query, stage and all. */
function servable(provider: ProviderEntry, query: Query): boolean {
  if (plan(query, [provider]).planned.length === 0) return false;

  // A provider that cannot narrow to the stages asked for would count its
  // whole match set under every other facet, and a count of a larger set is
  // not a floor on this one. None of the current providers is in that
  // position; this keeps it from mattering if one ever is.
  const stages = query.stages;
  if (!stages?.length) return true;
  const { holds, filter } = provider.capabilities.stages;
  return filter || holds.every(stage => stages.includes(stage));
}

/** What `before` resolves to when the deadline came first. */
const EXPIRED = Symbol('expired');

/**
 * Waits for `promise`, or for the deadline, whichever comes first — and says
 * which. Inferred from the clock afterwards instead, a timer that fired a
 * millisecond early left a millisecond of budget to start counting in.
 */
async function before<T>(deadline: number, promise: Promise<T>): Promise<T | typeof EXPIRED> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return EXPIRED;
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<typeof EXPIRED>(resolve => {
    timer = setTimeout(() => resolve(EXPIRED), remaining);
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const NO_TIME = 'no time left to count in';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function countSourceFacets(
  providers: readonly ProviderEntry[],
  options: SourceFacetsOptions
): Promise<SourceFacetsResult[]> {
  const { queries, searched, settled, openAccessOnly, budgetMs, cache, userAgent, now = () => new Date() } = options;
  const deadline = Date.now() + budgetMs;
  const years = yearWindow(queries.year, now());
  const asked = Object.keys(queries) as CountedFacet[];

  const countOne = async (provider: ProviderEntry): Promise<SourceFacetsResult | undefined> => {
    if (!provider.facets) return undefined;

    const requests: FacetRequest[] = provider.capabilities.facets.flatMap(facet => {
      const query = queries[facet];
      return query && servable(provider, query) ? [{ facet, query }] : [];
    });
    if (requests.length === 0) return undefined;

    const native = (query: Query) => provider.translate(query, { openAccessOnly });
    const searchedAs = native(searched);

    // A source counted one bucket at a time waits for its own search. See
    // `ProviderEntry.facetsAggregate` for why.
    const waited = provider.facetsAggregate ? undefined : await before(deadline, settled(provider.id));
    if (waited === EXPIRED) return { provider: provider.id, facets: {}, error: NO_TIME };
    const read = waited;

    const derived: SourceFacets = {};
    let remaining = requests;
    const known = new Map<string, number>();

    if (read?.report.status === 'ok' && read.report.totalHits !== undefined) {
      known.set(searchedAs, read.report.totalHits);

      /**
       * A search that read everything the source matched has every count in
       * hand already: counting its own records is exact, costs nothing, and
       * covers facets the source could not have counted otherwise — a narrow
       * search gets Europe PMC's venues. Only for a facet asked under the query
       * that was searched; one with its selection lifted is a different query.
       */
      if (read.papers.length >= read.report.totalHits) {
        const counted = generateFacets(read.papers);
        for (const facet of asked) {
          const query = queries[facet]!;
          if (native(query) === searchedAs && servable(provider, query)) derived[facet] = counted[facet];
        }
        remaining = requests.filter(({ facet }) => derived[facet] === undefined);
      }
    }

    if (remaining.length === 0) return { provider: provider.id, facets: derived };

    const budget = deadline - Date.now();
    if (budget <= 0) return { provider: provider.id, facets: derived, error: NO_TIME };

    const work = () => withBudget(budget, signal => provider.facets!({
      requests: remaining,
      years,
      openAccessOnly,
      timeoutMs: budget,
      signal,
      known,
      ...(userAgent ? { userAgent } : {})
    }));

    try {
      const outcome: ProviderFacetOutcome = cache
        ? (await cache.fetchFacets({
            provider: provider.id,
            requests: remaining.map(({ facet, query }) => ({ facet, nativeQuery: native(query) })),
            years,
            normalizerVersion: provider.normalizerVersion
          }, work)).outcome
        : await work();

      const failed = outcome.failures.length;
      return {
        provider: provider.id,
        facets: { ...outcome.facets, ...derived },
        ...(failed > 0 ? { error: `${failed} count${failed === 1 ? '' : 's'} failed: ${outcome.failures[0]}` } : {})
      };
    } catch (error) {
      return { provider: provider.id, facets: derived, error: message(error) };
    }
  };

  const results = await Promise.all(providers.map(countOne));
  return results.filter((result): result is SourceFacetsResult => result !== undefined);
}
