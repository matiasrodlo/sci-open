import type { ProviderCapabilities } from '@sci-open/shared';

/**
 * What Crossref's REST API can do as a search source, beside what the
 * authority of the same name asks it about a paper someone else found.
 *
 * It is the registry of most journal DOIs, closed papers included, and free
 * with no key. Measured on the references eval with OpenAlex left out, every
 * reference lost was a closed paper's DOI no other source holds — Akerlof's
 * "Lemons", Granovetter's "Weak Ties", the RSA paper — and Crossref holds all
 * of them.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * `query.bibliographic`, which Crossref built for matching a citation to its
   * record: title, authors, venue and year in any order. Asked by relevance;
   * it has no boolean syntax, so the request is the query's words and the
   * merged records are narrowed by `matchesQuery`.
   */
  keywordSearch: true,
  /** Author and venue clauses go to `query.author` and `query.container-title`. */
  fieldedSearch: true,
  doiLookup: true,
  /**
   * It says whether a paper is open for none of them, so an open-access search
   * does not ask it (`plan`). Asked for closed papers too, it is.
   */
  reportsAccess: false,
  skipReason: { openAccessOnly: 'reports no access status to filter on' },
  maxPageSize: 1000,
  /**
   * Its `total-results` counts every work sharing a word with the query:
   * 3,561,245 for "The Market for Lemons … Akerlof 1970". Not a count of
   * matches, so not reported as one.
   */
  reportsTotal: false,
  // `type`: `posted-content` is a preprint, the article and book types are
  // published, and the rest are unknown. Not narrowed by it here.
  stages: { holds: ['published', 'preprint', 'unknown'], filter: false },
  facets: []
};
