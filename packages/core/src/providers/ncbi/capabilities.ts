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

  // `sort=pub_date`, newest first, checked live on 2026-10-06. PubMed has no
  // oldest first and no citation counts to sort by.
  sorts: ['date'],

  // From the publication types: `preprint[pt]`, notices (`NOTICE_TYPES`)
  // unknown, and every other record published. See `normalize`.
  stages: { holds: ['preprint', 'published', 'unknown'], filter: true },

  // Counted with `rettype=count`, one request a year. ESearch has no facets.
  facets: ['year', 'stage']
};
