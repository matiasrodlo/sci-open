import type { ProviderCapabilities } from '@sci-open/shared';

/**
 * What the Europe PMC REST API can actually do.
 *
 * Facts about the API, checked against its responses and its documentation —
 * never estimates of how well it performs. The orchestrator uses these to
 * decide whether a query can be served at all, and to say which capability was
 * missing when it skips a provider.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Scoped to `TITLE_ABS`, `MESH` and `KW` — see `translate.ts`. Unscoped it
   * searched everything indexed and reported 521,177 matches for `ai` where
   * the title and abstract hold 54,005.
   */
  keywordSearch: true,
  fieldedSearch: true,
  doiLookup: true,

  maxPageSize: 1000,
  reportsTotal: true,

  // `sort=FIRST_PDATE_D desc` and `sort=CITED desc`, checked live on
  // 2026-10-06. Not oldest first: `P_PDATE_D asc` opened on papers of that
  // very week, so the ascending orders read by relevance here.
  sorts: ['date', 'citations'],

  // `SRC:PPR` is the preprint source, and `normalize` reads it the same way.
  stages: { holds: ['preprint', 'published', 'unknown'], filter: true },

  // Counted, one request a year: the REST search reports `hitCount` and has no
  // facets. The stage is two counts — preprints and everything else.
  facets: ['year', 'stage']
};
