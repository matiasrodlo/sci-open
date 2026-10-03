import type { Paper } from './paper';
import type { ProviderReport } from './provider';

/**
 * One value of a facet and how many papers carry it: counted over the read, or
 * the largest single source's count across everything it matches, whichever
 * is larger (see `withSourceCounts` in core).
 */
export type FacetBucket = {
  value: string | number;
  count: number;
};

/** Every facet, by name: `source`, `oaStatus`, `stage`, `year`, `venue`, `publisher`, `topics`. */
export type SearchFacets = Record<string, FacetBucket[]>;

/**
 * A search's answer as the pipeline holds it: the `Paper`s themselves and every
 * report whole, so a caller can say "found in three sources", "gold open
 * access" or "copy confirmed".
 */
export type SearchResponseV2 = {
  papers: Paper[];
  /** The size of the set the page is cut from — every page of a search reports the same one. */
  total: number;
  page: number;
  pageSize: number;
  facets: SearchFacets;
  /** False when a provider failed or timed out: `total` is then a lower bound. */
  complete: boolean;
  /** True when the rescue pass was cut short: `total` is then a lower bound too. */
  bounded: boolean;
  /** True when the sources' own counts describe this search. */
  countsFromSources: boolean;
  /** Every provider — answered, failed, timed out or skipped, and why. */
  providers: ProviderReport[];
};
