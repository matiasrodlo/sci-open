import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the DOAJ article search can actually do.
 *
 * `yearFilter` is the entry worth reading twice. The runbook expected it to be
 * declared false, because any year bound made DOAJ answer HTTP 400. It does
 * — but only for the form the old connector built. With the field named
 * `bibjson.year` and two concrete endpoints it is applied properly: a
 * 7,738-hit query splits into 2,011 + 2,658 + 3,067 across three adjacent
 * bounds. So the honest declaration is true, and the defect was in the query.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,

  // `bibjson.identifier.id:"10.x/y"` resolves to the single article.
  doiLookup: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    'publisher',
    'topics',
    // `bibjson.journal.language`, which the old connector's comment said DOAJ
    // does not supply.
    'language',
    'fullText',
    'landingPage'
  ],

  yearFilter: true,

  // DOAJ caps a single page at 100 articles.
  maxPageSize: 100,

  reportsTotal: true,

  // DOAJ holds no citation counts.
  suppliesCitations: false
};
