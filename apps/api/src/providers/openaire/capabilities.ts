import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the OpenAIRE search API can actually do.
 *
 * OpenAIRE is the only provider so far that reports an open-access *route* in
 * the same vocabulary `oaStatus` uses — `openAccessColor` holds `hybrid`,
 * `gold`, `bronze`, and `isGreen` covers the rest. Everywhere else that field
 * waits for Unpaywall.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  doiLookup: true,

  // No field search: see `fieldedSearch`. A query that is entirely
  // field-scoped leaves this provider nothing to search for, so it is
  // skipped with the reason rather than asked and reported as empty.
  fieldedSearch: false,
  skipReason: {
    fieldedSearch: 'takes keywords only, with no way to name a field'
  },

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    // The journal, from `container.name`. The old connector used `publisher`
    // for both, so every record's venue was the publishing house.
    'venue',
    'publisher',
    // From `subjects`, which the old connector never read — it wrote an empty
    // array on every record.
    'topics',
    'language',
    // Genuinely reported here, not inferred.
    'oaStatus',
    'fullText',
    'landingPage'
  ],

  // `fromPublicationDate` / `toPublicationDate` are request parameters rather
  // than query terms, so the bound is applied upstream.
  yearFilter: true,

  // OpenAIRE serves at most 100 results per page; more is HTTP 400.
  maxPageSize: 100,

  reportsTotal: true,
  suppliesCitations: false
};
