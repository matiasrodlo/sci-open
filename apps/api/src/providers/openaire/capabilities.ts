import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the OpenAIRE search API can actually do.
 *
 * OpenAIRE is the only provider so far that reports an open-access *route* in
 * the same vocabulary `oaStatus` uses — `openaccesscolor` holds `hybrid`,
 * `gold`, `bronze`, and `isgreen` covers the rest. Everywhere else that field
 * waits for Unpaywall.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  doiLookup: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    // The journal, from `journal`. The old connector used `publisher` for
    // both, so every record's venue was the publishing house.
    'venue',
    'publisher',
    // From `subject`, which the old connector never read — it wrote an empty
    // array on every record.
    'topics',
    'language',
    // Genuinely reported here, not inferred.
    'oaStatus',
    'fullText',
    'landingPage'
  ],

  // `fromDateAccepted` / `toDateAccepted` are request parameters rather than
  // query terms, so the bound is applied upstream.
  yearFilter: true,

  // OpenAIRE serves at most 100 results per page.
  maxPageSize: 100,

  reportsTotal: true,
  suppliesCitations: false
};
