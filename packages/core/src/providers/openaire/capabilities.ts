import type { ProviderCapabilities } from '@sci-open/shared';

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

  // OpenAIRE serves at most 100 results per page; more is HTTP 400.
  maxPageSize: 100,

  reportsTotal: true,

  // `sortBy=publicationDate DESC` and `citationCount DESC`, checked live on
  // 2026-10-06. Newest first opens on records dated 9999-01-01 unless the
  // read ends somewhere, so `fetchPage` ends it at the close of next year;
  // oldest first opens on 0001-12-30 and records with no date, and is left out.
  sorts: ['date', 'citations'],

  // Published when the instance is refereed, which `isPeerReviewed=true` asks
  // for; everything else is unknown. `normalize` never calls a record a
  // preprint, so a search for preprints skips OpenAIRE.
  stages: { holds: ['published', 'unknown'], filter: true },

  // Counted, one request a year: the Graph API reports `numFound` and has no
  // facets.
  facets: ['year', 'stage']
};
