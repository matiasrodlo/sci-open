import type { Query, QueryField, QueryJoin } from '@open-access-explorer/shared';
import { flatten, intersectYears, parseExpression, soleDoi } from '@open-access-explorer/shared';

/**
 * The user's text -> a structured Query.
 *
 * It used to say of itself that it was "not the advanced-search grammar". It is
 * now: `query-grammar.ts` holds the Web of Science syntax — field tags, `AND`,
 * `OR`, `NOT`, parentheses, wildcards and year ranges — and this is where that
 * parse becomes the `Query` the orchestrator fans out.
 *
 * Three things come out of one parse, and they are not alternatives to each
 * other:
 *
 * - `expression` is the query as written, and the only complete statement of
 *   it. `matchesQuery` enforces it over the merged records, which is what makes
 *   `NOT` and field scoping true for every provider rather than only the ones
 *   whose API can express them.
 * - `terms`, `phrases` and `join` are a deliberate *widening* of it, for
 *   `rank.ts` and for the providers translating without field support. See
 *   `flatten`: what they describe is always a superset of the real answer, so
 *   the narrowing above has something to narrow.
 * - `years` and `doi` are lifted out of the tree, because every provider
 *   already knows how to express those two and pushing them down costs nothing.
 *
 * A DOI still short-circuits the whole grammar. `10.1038/nature12373` is not a
 * keyword search and parsing it as one would scope a slash-bearing token to the
 * title, so the pattern is tried first, exactly as before.
 */

const DOI_PATTERN = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s]+)$/i;

export type ParseOptions = {
  /**
   * What two adjacent clauses with no operator between them mean.
   *
   * Unchanged in meaning from when this was a flat parser — `a b` under `OR` is
   * still either word — but it is now one input to the grammar rather than the
   * only structure there was. An explicit operator always wins over it.
   */
  join?: QueryJoin;
  years?: { from?: number; to?: number };
  /** The field an untagged word is scoped to. Defaults to Topic, as in WoS. */
  field?: QueryField;
};

export function parseQuery(input: string, options: ParseOptions = {}): Query {
  const text = (input ?? '').trim();
  const { join = 'AND', years, field } = options;

  const bounded = <T extends Query>(query: T): T =>
    years ? { ...query, years: { ...years } } : query;

  if (!text) return bounded({ terms: [], phrases: [], join });

  const doi = text.match(DOI_PATTERN)?.[1];
  if (doi) return bounded({ terms: [], phrases: [], join, doi });

  const expression = parseExpression(text, { join, ...(field ? { field } : {}) });

  // `DO=10.1038/...` is the tagged spelling of the same lookup, and routes the
  // same way. It is deliberately only the *sole* clause that does this: a DOI
  // sitting inside a larger boolean query is one condition among several, and
  // handing it to the DOI-lookup path would silently discard the rest.
  const tagged = soleDoi(expression);
  if (tagged) return bounded({ terms: [], phrases: [], join, doi: tagged });

  const flat = flatten(expression);

  // Both bounds narrow: one came from the year facet, the other from `PY=` in
  // the query text, and a search asking for both means the overlap.
  const bounds = intersectYears([...(years ? [years] : []), ...(flat.years ? [flat.years] : [])]);

  return {
    terms: flat.terms,
    phrases: flat.phrases,
    join: flat.join,
    ...(bounds ? { years: bounds } : {}),
    expression
  };
}
