import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the HAL search API can do, measured against api.archives-ouvertes.fr on
 * 2026-10-01.
 *
 * HAL is the French national open archive: authors deposit, and for the part
 * of it this provider reads, HAL hosts the file itself.
 *
 * Its corpus is not new to the other providers — on `crispr gene editing`, all
 * 92 DOIs among 100 HAL records with a file were in OpenAlex — but a search
 * reads only the top of each provider's answer, and HAL's top is not theirs.
 * Measured through the orchestrator on 2026-10-01, the same search with and
 * without HAL, no authorities:
 *
 * | query | without | with | HAL's records no other provider returned |
 * |---|---|---|---|
 * | `crispr gene editing` | 2,583 | 2,830 | 241 of 289 |
 * | `climate adaptation` | 3,535 | 4,068 | 556 of 599 |
 * | `ai` | 2,777 | 3,399 | 589 of 599 |
 * | `économie sociale` | 1,293 | 1,813 | 517 of 595 |
 *
 * Where HAL and a provider ranked above it returned the same paper, HAL's file
 * was the copy on 0 to 6 of them: the higher-ranked record usually had one.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Scoped to the title, the abstract and the keywords — see `translate.ts`.
   * 600 records come back in 2.4 to 3.4 s and 1,000 in 2.9 to 4.0 s, over
   * three queries, with no key; the budget is 20 s.
   */
  keywordSearch: true,
  fieldedSearch: true,

  // `doiId_s:"10.x/y"`, which matched with the DOI in either case.
  doiLookup: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    'publisher',
    'topics',
    'language',
    'fullText',
    'landingPage'
  ],

  // `producedDateY_i:[a TO b]`, with `*` for an open end.
  yearFilter: true,

  // Asked for 10,001 rows, HAL returns 10,000 without complaint. Measured at
  // 2,000 rows in 2.1 s with a short field list.
  maxPageSize: 10000,

  reportsTotal: true,

  // HAL holds no citation counts.
  suppliesCitations: false,

  /**
   * HAL's document type is the version. `UNDEFINED` is HAL's "pré-publication,
   * document de travail" — preprints and working papers — and the rest of what
   * is read is published work. Nothing read is `unknown`: `fetch.ts` asks for
   * those six types and no others, and theses are not among them.
   */
  stages: { holds: ['preprint', 'published'], filter: true },

  // Solr facets, every one in a single request. Not topics: `keyword_s` holds
  // each deposit's keywords in every language the author gave them, so a
  // count of them would mix "climat" and "climate" into separate buckets.
  facets: ['year', 'stage', 'venue', 'publisher']
};
