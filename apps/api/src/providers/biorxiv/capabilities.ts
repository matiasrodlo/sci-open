import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the bioRxiv/medRxiv API can do.
 *
 * The interesting entry is `keywordSearch`, and it is false because the API
 * has no keyword index at all — not because the search was implemented badly.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Off, because there is nothing to search.
   *
   * The API exposes date windows and a per-DOI lookup, and nothing else. A
   * keyword search was therefore a scan: fetch a 30-day window 30 records at a
   * time and grep the results in process. The recorded window reports **5,940
   * records**, and the scan was capped at 5 pages per server — 150 of 5,940,
   * across two servers, for ten HTTP requests. Anything posted more than 30
   * days ago was invisible regardless.
   *
   * So the ceiling was 2.5% of one month of a corpus that spans years, and a
   * live sweep bore that out: ten requests returning two records. This is a
   * property of the API, not a bug to work around, and declaring it means the
   * orchestrator skips bioRxiv with the reason named instead of spending the
   * requests.
   */
  keywordSearch: false,

  /**
   * On, and this is what the API is actually for. `/details/{server}/{doi}`
   * answers directly, and preprint DOIs are exactly what the other providers
   * are least likely to resolve.
   */
  doiLookup: true,

  fields: ['title', 'abstract', 'authors', 'year', 'venue', 'topics', 'language', 'fullText', 'landingPage'],

  // No query language, so no year clause either — the window is expressed in
  // the path, and a DOI lookup takes no bounds.
  yearFilter: false,

  // The details endpoint returns a fixed 30 records per cursor page.
  maxPageSize: 30,

  // A DOI lookup has no corpus-wide count to report.
  reportsTotal: false,

  suppliesCitations: false
};
