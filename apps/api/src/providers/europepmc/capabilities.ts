import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the Europe PMC REST API can actually do.
 *
 * Facts about the API, checked against its responses and its documentation —
 * never estimates of how well it performs. The orchestrator uses these to
 * decide whether a query can be served at all, and to say which capability was
 * missing when it skips a provider.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  doiLookup: true,

  // Populated on `resultType=core` responses. `publisher` is absent: Europe PMC
  // describes the journal, not who publishes it.
  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    'topics',
    'language',
    'citationCount',
    'fullText',
    'landingPage'
  ],

  // PUB_YEAR is a query term, so a year bound narrows the corpus rather than
  // being filtered afterwards — which also makes the reported hit count honest.
  yearFilter: true,

  maxPageSize: 1000,
  reportsTotal: true,

  // `citedByCount` is on every core record. The old connector never read it,
  // which is why Europe PMC contributed nothing to the citations sort.
  suppliesCitations: true
};
