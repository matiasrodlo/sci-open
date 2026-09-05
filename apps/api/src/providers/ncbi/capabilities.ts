import type { ProviderCapabilities } from '@open-access-explorer/shared';

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

  // `"10.x/y"[DOI]` resolves to the single record.
  doiLookup: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    // MeSH descriptors where PubMed has indexed the article, author keywords
    // where it has not. The old connector wrote `topics: []` on every record.
    'topics',
    'language',
    'fullText',
    'landingPage'
  ],

  // `2022:2023[PDAT]`, verified as above.
  yearFilter: true,

  // Abstract XML for a page of PMIDs is bulky; this is the ceiling the old
  // connector used and there is no reason to raise it.
  maxPageSize: 500,

  // `esearchresult.count`.
  reportsTotal: true,

  // PubMed holds no citation counts.
  suppliesCitations: false
};
