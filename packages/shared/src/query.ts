import type { PaperStage } from './paper';

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

/**
 * The fields a clause can be scoped to, and the Web of Science tag each is
 * written with.
 *
 * Named for what they mean rather than for the tag, because the tag is one
 * surface syntax and the providers each have their own — Europe PMC spells the
 * title `TITLE`, arXiv spells it `ti`, DOAJ spells it `bibjson.title`. The
 * parser maps tags in, `translate` maps them out, and nothing in between has to
 * know that `SO` was ever involved.
 *
 * `topic` is the one that is not a field of a record: Web of Science searches
 * title, abstract and keywords together under `TS=`, and it is the default for
 * an untagged word because it is what a reader means by "about". `all` is
 * wider still and is what the providers search when given nothing.
 */
export type QueryField =
  | 'all'
  | 'topic'
  | 'title'
  | 'abstract'
  | 'author'
  | 'venue'
  | 'publisher'
  | 'year'
  | 'doi';

/**
 * What a clause is matched against.
 *
 * A term may carry the wildcards `*` and `?`. They are kept in the text rather
 * than compiled here, because every consumer wants them in a different form:
 * a provider that supports wildcards wants them passed through, one that does
 * not wants them stripped, and the local evaluator wants a regular expression.
 */
export type QueryValue =
  | { kind: 'term'; text: string }
  | { kind: 'phrase'; text: string }
  | { kind: 'years'; range: YearRange };

/**
 * A parsed query, as a tree.
 *
 * This is the thing `Query.terms` and `Query.phrases` could not express, and
 * the reason the advanced-search tab was deleted in phase 11 rather than
 * repaired: a flat bag of words has nowhere to put `NOT`, nowhere to put a
 * field, and no way to say that two clauses are alternatives to each other.
 */
export type QueryNode =
  | { kind: 'and'; nodes: QueryNode[] }
  | { kind: 'or'; nodes: QueryNode[] }
  | { kind: 'not'; node: QueryNode }
  | { kind: 'clause'; field: QueryField; value: QueryValue };

export type Query = {
  /**
   * Bare words. How they combine is `join`.
   *
   * Kept beside `expression` rather than replaced by it, and the relationship
   * between the two is load-bearing. These are a *flattening* of the tree —
   * see `flatten` — computed so that a consumer which knows nothing about
   * fields or `NOT` still runs a query whose results are a **superset** of the
   * real answer. `rank.ts` scores against them, and a provider whose API has no
   * boolean syntax at all translates from them.
   *
   * A superset is the safe direction and the only one that works: the
   * orchestrator narrows it back down with `matchesQuery`, which it cannot do
   * for a record a provider never returned.
   */
  terms: string[];
  /** Quoted runs that must stay adjacent and in order. */
  phrases: string[];
  /** How `terms` combine. Phrases are always required. */
  join: QueryJoin;
  /** Inclusive at both ends. Providers that cannot express it say so. */
  years?: YearRange;
  /**
   * Which versions of a work to ask for — set when the reader ticks a
   * publication type, and absent otherwise.
   *
   * It is sent rather than only applied to what comes back, for the reason
   * `years` is: a filter applied after the fan-out narrows a read of the top
   * of every source, so ticking "Pre-print" used to leave the few hundred
   * preprints that happened to be in that read, while the sources held a
   * hundred thousand. Sent, each source spends its read on the slice asked
   * for, and its count is a count of that slice.
   *
   * A provider whose records are all one stage has nothing to add to its query
   * and is simply not asked when that stage is excluded — see
   * `ProviderCapabilities.stages` and `plan`.
   */
  stages?: PaperStage[];
  /** Set when the query is a DOI lookup rather than a keyword search. */
  doi?: string;
  /**
   * The parsed query, when the input had structure worth keeping.
   *
   * Absent for a DOI lookup, which is not a keyword search at all. Present for
   * everything else, including a plain `crispr gene editing` — a bare word is
   * a clause on the default field, so the tree is the whole truth about the
   * query and the flattening above is derived from it, never the other way
   * round.
   */
  expression?: QueryNode;
};
