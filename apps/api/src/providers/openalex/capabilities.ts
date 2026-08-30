import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the OpenAlex works API can do.
 *
 * The largest provider in the fan-out, and the last to be migrated — it was
 * blocked for most of phase 08 because its daily budget was spent and a
 * fixture could not be recorded.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  doiLookup: true,

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
  suppliesCitations: true
};
