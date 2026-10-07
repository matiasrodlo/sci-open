import type { Query, QueryField, QueryNode } from '@sci-open/shared';

/**
 * Query -> Crossref's request parameters, as a URL query string; `doi:<doi>`
 * for a DOI lookup, which goes to the single-record endpoint instead. Pure,
 * and the only place that knows this API's syntax.
 *
 * Crossref ranks works by how well they match a bag of words, with no boolean
 * syntax to send. So the request is every word `flatten` puts in `terms` and
 * `phrases` — a superset, as the type requires — in `query.bibliographic`,
 * and the merged records are narrowed by `matchesQuery`. Author and venue
 * clauses, which `flatten` leaves out of the words, go to their own fields.
 */

export type TranslateOptions = {
  /** Accepted and ignored: an open-access search does not ask Crossref (`reportsAccess`). */
  openAccessOnly?: boolean;
};

const FIELD_PARAMS: Partial<Record<QueryField, string>> = {
  author: 'query.author',
  venue: 'query.container-title'
};

/** The words of each author and venue clause, outside any NOT. */
function fieldWords(node: QueryNode, into: Map<string, string[]>): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) fieldWords(child, into);
    return;
  }
  // A word to leave out cannot be asked for in a ranking.
  if (node.kind === 'not') return;
  const param = FIELD_PARAMS[node.field];
  if (!param || node.value.kind === 'years') return;
  const text = node.value.text.trim();
  if (text) into.set(param, [...(into.get(param) ?? []), text]);
}

export function translate(query: Query, _options: TranslateOptions = {}): string {
  if (query.doi) return `doi:${query.doi.trim()}`;

  const params = new URLSearchParams();
  const words = [...query.terms, ...query.phrases].map(w => w.trim()).filter(Boolean);
  if (words.length) params.set('query.bibliographic', words.join(' '));

  const fields = new Map<string, string[]>();
  if (query.expression) fieldWords(query.expression, fields);
  for (const [param, values] of fields) params.set(param, values.join(' '));

  // Nothing to rank by: a year alone would list everything of that year.
  if (![...params.keys()].length) return '';

  const { from, to } = query.years ?? {};
  const filters = [
    ...(from !== undefined ? [`from-pub-date:${from}`] : []),
    ...(to !== undefined ? [`until-pub-date:${to}`] : [])
  ];
  if (filters.length) params.set('filter', filters.join(','));

  return params.toString();
}
