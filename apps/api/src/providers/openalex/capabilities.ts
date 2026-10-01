import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the OpenAlex works API can do.
 *
 * The largest provider in the fan-out, and the last to be migrated — it was
 * blocked for most of phase 08 because its daily budget was spent and a
 * fixture could not be recorded.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Scoped to `title_and_abstract.search` — see `translate.ts`. The `search`
   * parameter reads the full text too, and reported 4,636,103 matches for `ai`
   * where the title and abstract hold 940,199.
   */
  keywordSearch: true,
  doiLookup: true,

  /**
   * Title, abstract, topic and author, each as its own `*.search` filter —
   * see `FIELD_FILTERS` in `translate.ts` for the keys and the measurements
   * behind them.
   *
   * True rather than exact: `SO=` and `PU=` have no filter key here, and every
   * candidate for one answers HTTP 400. This flag only decides whether `plan`
   * asks at all, and asking is right whenever *some* of a query can be stated.
   * The rest is caught a step later — a query OpenAlex can say nothing about
   * translates to an empty string, and `fanOut` reports it skipped rather than
   * letting it answer `0` to a question it never received.
   */
  fieldedSearch: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    // From `primary_location.source.host_organization_name`, not `publisher` —
    // see the note in `normalize`.
    'publisher',
    'topics',
    'language',
    'citationCount',
    // `open_access.oa_status` is Unpaywall's own vocabulary, reported directly.
    'oaStatus',
    'fullText',
    'landingPage'
  ],

  // `publication_year:2022-2024`, verified against responses — and against the
  // form the old path used, which OpenAlex rejects. See `translate`.
  yearFilter: true,

  // OpenAlex caps a single page at 200.
  maxPageSize: 200,

  // `meta.count`.
  reportsTotal: true,

  // `cited_by_count`, on every record. OpenAlex was the only provider feeding
  // the citations sort before Europe PMC was migrated.
  suppliesCitations: true,

  // Read from `type`, which a `type:` filter narrows to the same values.
  stages: { holds: ['preprint', 'published', 'unknown'], filter: true },

  // All five, from `group_by` — one request each, billed as a list query
  // rather than a search ($0.0001 against $0.001, measured 2026-09-25).
  facets: ['year', 'stage', 'venue', 'publisher', 'topics']
};
