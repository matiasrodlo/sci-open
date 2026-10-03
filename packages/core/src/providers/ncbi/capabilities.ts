import type { ProviderCapabilities } from '@sci-open/shared';

/**
 * What the NCBI E-utilities can actually do for PubMed.
 *
 * Checked against responses. The year filter in particular: three different
 * spellings of a 2022–2023 bound all returned 3,222 against 13,508 unbounded,
 * so it is genuinely applied upstream rather than accepted and ignored.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Scoped to `[tiab]` and `[mh]` — see `translate.ts`. Worth knowing here
   * because `reportsTotal` below is a count of *this* query, and unscoped it
   * was counting a different thing from every other provider in the fan-out:
   * 287,637 for `ai` against 60,399 in the title or abstract.
   */
  keywordSearch: true,
  fieldedSearch: true,

  // `"10.x/y"[DOI]` resolves to the single record.
  doiLookup: true,

  // Abstract XML for a page of PMIDs is bulky; this is the ceiling the old
  // connector used and there is no reason to raise it.
  maxPageSize: 500,

  // `esearchresult.count`.
  reportsTotal: true,

  // Published when PubMed Central holds it, which `pubmed pmc[sb]` asks for.
  // Under the open-access filter every record is in PMC already.
  stages: { holds: ['published', 'unknown'], filter: true },

  // Counted with `rettype=count`, one request a year. ESearch has no facets.
  facets: ['year', 'stage']
};
