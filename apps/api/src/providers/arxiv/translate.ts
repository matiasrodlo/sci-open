import type { Query, QueryField } from '@open-access-explorer/shared';
import { renderExpression, type Dialect } from '../render-query';

/**
 * Query -> the arXiv `search_query` string. Pure, and the only place that
 * knows this API's syntax.
 *
 * This provider is the clearest case for why `Query` exists. The old connector
 * sent the user's words through as `all:crispr gene editing`, and arXiv reads
 * that as `all:crispr OR all:gene OR all:editing` — measured: 23,510 hits
 * whose top two results were "Primer on the Gene Ontology" and "Gene Ontology:
 * Pitfalls, Biases, Remedies", neither about CRISPR. The same words joined
 * with AND return 16, all of them on the subject. A raw string gave the
 * connector no way to say which words were required, so it could not have
 * asked the question the user meant.
 */

/**
 * The two fields a search for a subject means, and arXiv has no combined
 * default for them.
 *
 * `all:` was here, and it is every metadata field arXiv holds — the authors,
 * the submitter's comments, the journal reference, the category names. On a
 * word that is also a surname or a category that is mostly noise, and the
 * count it produced sat in the panel beside DOAJ's title/abstract/keywords
 * figure as though the two answered the same question.
 *
 * Each term gets its own `(ti: OR abs:)` pair rather than one pair wrapping
 * the whole query, because a field prefix binds to the token after it and
 * nothing else — the same trap Europe PMC has, where `TITLE_ABS:gene editing`
 * scopes `gene` and leaves `editing` loose across the index.
 *
 * Worth stating plainly: this is a guard rather than a measured win. On
 * `crispr` the two forms return **112 records each** — nobody is named Crispr
 * and it is not a category, so `all:` had nothing extra to match. The change
 * earns itself on a word that collides with an author's surname or a category
 * label, which is exactly the case that made PubMed's unscoped count 4.8×
 * its title-and-abstract one. arXiv's own rate limiting kept that comparison
 * from being measured here.
 *
 * `cat:` is deliberately not in the list, though it is the nearest thing arXiv
 * has to the subject index that `MESH`, `KW` and PLOS's `subject` contribute
 * elsewhere. Its values are codes — `cs.AI`, `q-bio.GN` — so a word query
 * cannot match one, and including it would add a clause that can only ever
 * return nothing.
 */
const FIELDS = ['ti', 'abs'] as const;

/**
 * Concrete endpoints for a half-open range, because arXiv rejects a wildcard
 * one — see the note on `submittedDate` below. 1991 is arXiv's first year.
 */
const EARLIEST = '199101010000';
const LATEST = '999912312359';

/**
 * arXiv documents no escape for a quote inside a quoted phrase, and an
 * unbalanced one makes the parser reject the whole query. Dropping it is the
 * only option that keeps the rest of the phrase searchable.
 */
function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * A single range with two real endpoints. The wildcard form the old connector
 * used — `submittedDate:[202201010000 TO *]`, and both bounds as two AND-ed
 * clauses — makes arXiv answer **HTTP 500** with an error document in the feed.
 * The connector caught that and returned an empty array, so arXiv dropped out
 * of every year-filtered search entirely, and nothing distinguished it from a
 * query that matched nothing.
 */
function submittedDate({ from, to }: { from?: number; to?: number }): string {
  const start = from !== undefined ? `${from}01010000` : EARLIEST;
  const end = to !== undefined ? `${to}12312359` : LATEST;
  return `submittedDate:[${start} TO ${end}]`;
}

/** One search word or quoted phrase, in the title or the abstract. */
function scoped(value: string): string {
  return `(${FIELDS.map(field => `${field}:${value}`).join(' OR ')})`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. arXiv is a preprint repository — every record it
   * holds is free to read — so there is no access filter to apply, and adding
   * a clause for one would only narrow the query for no reason. Declining to
   * act on it here is what keeps the orchestrator from having to special-case
   * which providers understand the option.
   */
  openAccessOnly?: boolean;
};

/**
 * arXiv's prefixes for the query grammar's fields.
 *
 * `topic` keeps the `ti`/`abs` pair `FIELDS` already declared. arXiv has no
 * subject-keyword index to add to it the way Europe PMC has `MESH`, and `cat:`
 * is its subject taxonomy — a category code, not a word a reader would type.
 *
 * `all` is arXiv's own catch-all prefix rather than the union of the others,
 * because arXiv supplies one and it is wider than any list assembled here.
 * `publisher` has nothing: arXiv is a preprint server and its records have no
 * imprint, so a clause on it widens to `all` and the local evaluator settles
 * the record on the field data it actually holds.
 */
const QUERY_FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: FIELDS,
  title: ['ti'],
  abstract: ['abs'],
  author: ['au'],
  venue: ['jr'],
  all: ['all']
};

const DIALECT: Dialect = {
  fields: field => QUERY_FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  term: text => text.trim(),
  phrase: text => quote(text),
  years: range => submittedDate(range),
  // arXiv has no DOI index — the same fact `capabilities.doiLookup` declares.
  // A DOI clause inside a larger query is therefore left to the evaluator.
  doi: () => undefined,
  unscoped: value => `all:${value}`,
  /**
   * arXiv spells negation `ANDNOT`, as an infix operator between two clauses,
   * where `renderExpression` emits a `NOT` prefix. Rather than assemble a
   * second shape for one provider, the clause is dropped and `matchesQuery`
   * applies it over the merged records — which is the documented fallback and
   * costs only breadth, never correctness.
   */
  supportsNot: false
};

/** The query as it reached this provider before the grammar existed. */
function flatClauses(query: Query): string[] {
  const clauses: string[] = [];

  const terms = query.terms.filter(t => t.trim()).map(t => scoped(t.trim()));
  const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the clauses beside it —
    // `all:a OR all:b AND submittedDate:[...]` does not mean what it looks
    // like.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }

  // Phrases are always required, whatever `join` says about the bare terms.
  clauses.push(...phrases);

  return clauses;
}

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  // No DOI clause: arXiv has no DOI index, which `capabilities.doiLookup`
  // declares, so the orchestrator never routes a DOI lookup here.
  const rendered = query.expression ? renderExpression(query.expression, DIALECT) : undefined;
  if (rendered) clauses.push(rendered);
  else clauses.push(...flatClauses(query));

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(submittedDate(query.years!));
  }

  return clauses.join(' AND ');
}
