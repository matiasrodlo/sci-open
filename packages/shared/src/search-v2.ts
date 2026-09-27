import type { AuthorityReport } from './authority';
import type { Paper, ProviderId } from './paper';
import type { ProviderReport } from './provider';
import type { SearchFilters, SearchSort } from './types';

/**
 * One value of a facet and how many papers carry it.
 *
 * `from` names the source whose own count this is, when it is one — the
 * largest single source's count across everything it matches, which beat what
 * the search read. Absent when the count was taken from the read.
 */
export type FacetBucket = {
  value: string | number;
  count: number;
  from?: ProviderId;
};

/** Every facet, by name: `source`, `oaStatus`, `stage`, `year`, `venue`, `publisher`, `topics`. */
export type SearchFacets = Record<string, FacetBucket[]>;

/**
 * `POST /api/v2/search`: the answer as the pipeline holds it.
 *
 * Version 1 flattens every paper to an `OARecord`, which keeps one source of
 * several, calls the publication stage `oaStatus`, reduces a copy to a URL,
 * and has nowhere for the access route, a verified copy, or which source
 * supplied a field — and reduces each provider's report to two counts. This
 * returns the `Paper` itself and the reports whole, so a client can say
 * "found in three sources", "gold open access" or "copy confirmed".
 *
 * The same search as version 1, from the same held set: the two answer from
 * one run and cannot disagree.
 */
export type SearchResponseV2 = {
  papers: Paper[];
  /** The size of the set the page is cut from — every page of a search reports the same one. */
  total: number;
  page: number;
  pageSize: number;
  sort: SearchSort;
  /** Echoed when the request set them. */
  filters?: SearchFilters;
  facets: SearchFacets;
  /** False when a provider failed or timed out: `total` is then a lower bound. */
  complete: boolean;
  /** True when the rescue pass was cut short: `total` is then a lower bound too. */
  bounded: boolean;
  /** True when the sources' own counts describe this search. */
  countsFromSources: boolean;
  /** Every provider — answered, failed, timed out or skipped, and why. */
  providers: ProviderReport[];
  /** What each authority was asked about this page, and what it filled in. */
  authorities: AuthorityReport[];
  duration: number;
};
