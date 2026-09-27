import type { CountedFacet, FacetCount, PaperStage, Query, SourceFacets } from '@open-access-explorer/shared';

/**
 * Whole-index facet counts, for a provider whose API can report a total and
 * nothing finer.
 *
 * A facet bucket is then a count of a narrower query: the papers from 2024 are
 * the query with its years set to 2024, and the preprints are the query with
 * its stages set to `preprint`. Every provider already translates both, so a
 * bucket costs one request and no new syntax — which is the whole reason this
 * works for five providers with nothing in common but a hit count.
 *
 * What it cannot do is a facet with open-ended values. There is no query for
 * "each venue", only for a venue already named, so venues, publishers and
 * topics come from the two providers that aggregate natively and from this
 * service's own read.
 */

/** One facet to count, and the query it is counted under. */
export type FacetRequest = {
  facet: CountedFacet;
  /**
   * Not always the search's query. A facet is counted with its own selection
   * lifted — the year facet under the query without the ticked years — so that
   * ticking one year leaves the others visible and countable. See `facet.ts`.
   */
  query: Query;
};

export type ProviderFacetArgs = {
  requests: readonly FacetRequest[];
  /**
   * The years a year facet is counted for, newest first, by a provider that
   * asks one year at a time. The two that aggregate count every year at once
   * and ignore it.
   */
  years: readonly number[];
  openAccessOnly: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
  /**
   * A count this provider has already reported, by native query — its search's
   * `totalHits`. A single-stage provider's stage bucket is exactly its total, so
   * this is usually the whole of that facet, and asking again would spend a
   * request on a number already in hand.
   */
  known?: ReadonlyMap<string, number>;
};

export type ProviderFacetOutcome = {
  facets: SourceFacets;
  /**
   * Counts that were asked for and did not arrive. Not thrown: a bucket that
   * could not be counted leaves a floor lower than it could have been, and the
   * rest are still true. Non-empty keeps the outcome out of the cache, so a
   * rate limit that cost three years is not remembered for ten minutes.
   */
  failures: string[];
};

/**
 * How fast a provider may be asked, as a token bucket: `burst` requests at
 * once, then `perSecond`.
 *
 * Measured against two providers that enforce it, 2026-09-25, ten count
 * requests in one burst: DOAJ answered one of them 429, and PubMed without a
 * key answered three of six 429. The search is not paced and does not need to
 * be — it is a handful of requests — but the counts are the provider's second
 * burst in as many seconds, and they arrive after the search for that reason.
 */
export type Pace = { burst: number; perSecond: number };

export type CountSpec = {
  /** `capabilities.stages.holds`. */
  holds: readonly PaperStage[];
  /** The native query, for deduplication and for `known`. Empty means "nothing to ask". */
  translate(query: Query): string;
  count(query: Query): Promise<number>;
  pace: Pace;
  signal?: AbortSignal;
};

type Job = { facet: CountedFacet; value: string | number; query: Query; native: string };

/** The years a request's own bound admits, from the window the orchestrator chose. */
function yearsWithin(query: Query, years: readonly number[]): number[] {
  const { from, to } = query.years ?? {};
  return years.filter(year => (from === undefined || year >= from) && (to === undefined || year <= to));
}

/**
 * The stages worth a count. `unknown` is never one: it is what a provider says
 * of a record it cannot place, not something a query can select, and the panel
 * has no bucket for it.
 */
function countableStages(holds: readonly PaperStage[]): PaperStage[] {
  return holds.filter(stage => stage !== 'unknown');
}

function jobsFor(args: ProviderFacetArgs, spec: CountSpec): Job[] {
  const jobs: Job[] = [];

  const add = (facet: CountedFacet, value: string | number, query: Query) => {
    const native = spec.translate(query);
    if (native) jobs.push({ facet, value, query, native });
  };

  for (const { facet, query } of args.requests) {
    if (facet === 'year') {
      for (const year of yearsWithin(query, args.years)) {
        add('year', year, { ...query, years: { from: year, to: year } });
      }
    } else if (facet === 'stage') {
      const stages = countableStages(spec.holds);
      for (const stage of stages) {
        // A provider that holds one stage has nothing to narrow: its total is
        // the bucket. Setting `stages` anyway would change nothing it sends
        // but would make the query look different from the one it searched.
        add('stage', stage, spec.holds.length === 1 ? query : { ...query, stages: [stage] });
      }
    }
    // Venue, publisher and topics have no query per value. See the note above.
  }

  return jobs;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

/**
 * Starts each task on the token-bucket schedule `pace` describes and settles
 * them all. The schedule is fixed in advance, which is enough: these are the
 * only requests this module makes, and they are all made here.
 */
export async function paced<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  pace: Pace,
  signal?: AbortSignal
): Promise<PromiseSettledResult<T>[]> {
  const burst = Math.max(pace.burst, 1);
  const interval = 1000 / Math.max(pace.perSecond, Number.MIN_VALUE);

  return Promise.allSettled(
    tasks.map(async (task, index) => {
      await sleep(index < burst ? 0 : Math.ceil((index - burst + 1) * interval), signal);
      return task();
    })
  );
}

export async function countFacets(args: ProviderFacetArgs, spec: CountSpec): Promise<ProviderFacetOutcome> {
  const jobs = jobsFor(args, spec);

  // The same native query can be two jobs — the year facet's 2024 and, when
  // 2024 is ticked, nothing else — so each is asked once.
  const unasked = [...new Set(jobs.map(job => job.native))].filter(native => !args.known?.has(native));
  const queryOf = new Map(jobs.map(job => [job.native, job.query]));

  const settled = await paced(unasked.map(native => () => spec.count(queryOf.get(native)!)), spec.pace, spec.signal);

  const counts = new Map<string, number>(args.known ?? []);
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') counts.set(unasked[index]!, result.value);
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  });

  const facets: SourceFacets = {};
  for (const job of jobs) {
    const count = counts.get(job.native);
    // Zero is left out rather than listed: a facet lists the values papers
    // carry, and a year with none is not one of them.
    if (count === undefined || count <= 0) continue;
    const buckets: FacetCount[] = facets[job.facet] ?? (facets[job.facet] = []);
    buckets.push({ value: job.value, count });
  }

  // Every facet that was asked for is present, even when it came back with no
  // buckets, so that "counted, and nothing matched" and "not counted" stay
  // different things. A facet whose every count failed is the second.
  for (const { facet } of args.requests) {
    const asked = jobs.filter(job => job.facet === facet);
    const answered = asked.some(job => counts.has(job.native));
    if (answered && !facets[facet]) facets[facet] = [];
  }

  return { facets, failures };
}
