/**
 * The structured form of a search, and the only thing a provider translates
 * from.
 *
 * Deliberately small: it is not a search grammar. Its job is to carry enough
 * structure that each provider can build a correct native query, which today
 * they cannot — arXiv receives `all:crispr gene editing` and turns it into
 * `all:crispr OR all:gene OR all:editing`, because a raw string gives it
 * nothing to distinguish a phrase from a bag of words. Anything a provider
 * cannot express, it declares in its capabilities and the orchestrator routes
 * around.
 */
export type QueryJoin = 'AND' | 'OR';

export type YearRange = {
  from?: number;
  to?: number;
};

export type Query = {
  /** Bare words. How they combine is `join`. */
  terms: string[];
  /** Quoted runs that must stay adjacent and in order. */
  phrases: string[];
  /** How `terms` combine. Phrases are always required. */
  join: QueryJoin;
  /** Inclusive at both ends. Providers that cannot express it say so. */
  years?: YearRange;
  /** Set when the query is a DOI lookup rather than a keyword search. */
  doi?: string;
};

/** An empty query, for tests and for building one up. */
export const EMPTY_QUERY: Query = { terms: [], phrases: [], join: 'AND' };

/** True when there is nothing for a provider to search on. */
export function isEmptyQuery(query: Query): boolean {
  return !query.doi && query.terms.length === 0 && query.phrases.length === 0;
}
