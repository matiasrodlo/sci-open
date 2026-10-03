import type { ProviderCapabilities } from '@sci-open/shared';

/**
 * What the DOAJ article search can actually do. (A year bound works too, with
 * the field named `bibjson.year` and two concrete endpoints: a 7,738-hit query
 * splits into 2,011 + 2,658 + 3,067 across three adjacent bounds. See
 * `translate`.)
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  fieldedSearch: true,

  // `bibjson.identifier.id:"10.x/y"` resolves to the single article.
  doiLookup: true,

  // DOAJ caps a single page at 100 articles.
  maxPageSize: 100,

  reportsTotal: true,

  // A directory of journals: every article is the published version.
  stages: { holds: ['published'], filter: false },

  // Counted, one request a year: the search API reports a total and no
  // aggregations. The Elasticsearch endpoint behind the site does aggregate,
  // and answers a script with 403 — it is behind bot protection, which is not
  // ours to get round.
  facets: ['year', 'stage']
};
