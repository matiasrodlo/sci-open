import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the PLOS Solr endpoint can actually do.
 *
 * The least eventful of the providers migrated so far, and the checks are
 * recorded because "straightforward" is a claim like any other: `everything:`
 * already ANDs its terms (5,940 hits either way, spelled implicitly or
 * explicitly), and the date range narrows 6,644 to 1,173.
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
    // From the `subject` field, which the old connector never requested — it
    // put the article type in `topics` instead, so every PLOS record was
    // tagged "Research Article" and nothing else.
    'topics',
    'language',
    'fullText',
    'landingPage'
  ],

  yearFilter: true,

  // PLOS's Solr endpoint serves up to 1000 rows per request.
  maxPageSize: 1000,

  reportsTotal: true,
  suppliesCitations: false
};
