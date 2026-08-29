import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the DataCite API can do, and what it is worth asking.
 *
 * The runbook left this one as a decision rather than a fix: DataCite
 * contributed 600 records of which none survived filtering, so either fix what
 * it emits or stop paying for it. It is decided here on measurement.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Off, on the evidence.
   *
   * Three measurements, all on a live `crispr gene editing` search:
   *
   * - Of 100 records, **1** carried `application/pdf` in `formats`, **0**
   *   carried an `IsPublishedIn` relation, and **no** registered URL ended in
   *   `.pdf`. DataCite registers DOIs; it does not host papers. Under a
   *   retrievability filter its records will always drop out, and that is not
   *   a defect to fix — it is what the corpus is.
   * - Of 87 records returned through the new provider, **1** survived the
   *   policy filter.
   * - Of those 87 DOIs, **0** appeared in any of the other six providers'
   *   results.
   *
   * That last one is the decisive one, and it refutes the obvious argument for
   * keeping it. A provider that finds nothing readable can still earn its
   * request by supplying DOIs for works other providers also found, adding
   * provenance to records that survive on someone else's full text. DataCite
   * does not: its DOIs are for institutional-repository items, theses and
   * datasets that the literature providers do not index, so they are disjoint
   * from theirs by construction. Zero overlap, not a small one.
   *
   * So a keyword search here costs one HTTP request per query and returns
   * records that are dropped and merge with nothing. The orchestrator now
   * skips it and says why, which is a better outcome than the old silent
   * contribution of 600 records to a filter.
   */
  keywordSearch: false,

  /**
   * On, and this is the case DataCite is actually good for. A DataCite DOI
   * resolves here and nowhere else in the fan-out — precisely because the
   * corpus is disjoint.
   */
  doiLookup: true,

  fields: ['title', 'abstract', 'authors', 'year', 'publisher', 'topics', 'language', 'landingPage'],

  // `publicationYear:[a TO b]`, and DataCite accepts a wildcard endpoint where
  // arXiv answers 500 and DOAJ answers 400.
  yearFilter: true,

  maxPageSize: 1000,
  reportsTotal: true,
  suppliesCitations: false
};
