import type { Query, QueryField, YearRange } from '@open-access-explorer/shared';
import { renderExpression, type Dialect } from '../render-query';

/**
 * Query -> the Europe PMC query string. Pure, and the only place that knows
 * this API's syntax.
 *
 * Being handed structure rather than a raw string is the point. The old
 * connector passed the user's text through untouched, so a multi-word search
 * was whatever Europe PMC chose to make of it, and there was no way to express
 * "these words must be adjacent" at all.
 */

export type TranslateOptions = {
  /**
   * Restrict to open access.
   *
   * An explicit request option rather than a constant baked into the provider.
   * The old connector always appended it, which meant the OA policy lived in
   * eleven different connectors and could not be turned off for a caller that
   * wanted to see what it was excluding.
   *
   * Worth knowing: `OPEN_ACCESS:y` is a query term, not a request parameter.
   * There is no `openAccessOnly` parameter — passing one is silently ignored
   * and most of the page comes back closed.
   */
  openAccessOnly?: boolean;
};

/** Escapes a phrase for use inside Europe PMC's double-quoted syntax. */
function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, '\\"')}"`;
}

/**
 * One search word, scoped to the title, the abstract, the MeSH headings and
 * the author keywords.
 *
 * Unscoped, Europe PMC searches everything it indexes, and beside DOAJ's
 * title/abstract/keywords count in the same panel that was a different
 * question wearing the same label. Measured on `ai` with `OPEN_ACCESS:y`:
 * **521,177** unscoped against **54,005** in `TITLE_ABS`.
 *
 * `MESH` and `KW` ride along because here they are not a rounding error the
 * way PubMed's `[mh]` is. Measured on `crispr` with `OPEN_ACCESS:y`: 31,567 in
 * `TITLE_ABS` alone, **34,916** with the two beside it — a tenth of the
 * matches are records indexed under the subject whose title and abstract never
 * say the word.
 *
 * A word in none of the four vocabularies matches nothing rather than failing,
 * verified live.
 *
 * Each term carries its own prefix, and this is the trap worth naming: a field
 * prefix binds to the *next token only*. `TITLE_ABS:gene editing` scopes
 * `gene` and leaves `editing` loose across the whole index — 220,538 matches
 * where the quoted phrase has 7,740.
 */
function scoped(term: string): string {
  return `(TITLE_ABS:${term} OR MESH:${term} OR KW:${term})`;
}

/**
 * One record's own id -> the query that retrieves exactly it.
 *
 * Separate from `translate` because the two are asking different questions,
 * and routing a native id through `translate` answers the wrong one. The id
 * arrives as a bare term, so `scoped` puts it in TITLE_ABS, MESH and KW — none
 * of which contain it. Measured live on 2026-09-04 for PMID 37494408:
 * `(TITLE_ABS:37494408 OR MESH:37494408 OR KW:37494408)` returns **0**, and
 * `EXT_ID:"37494408"` returns the one record. The paper endpoint 404'd on
 * every Europe PMC id as a result.
 *
 * `EXT_ID` is the right field for all three id shapes this provider mints,
 * because `normalize` takes `nativeId` from the record's own `id`: verified
 * live against a MED PMID, a `PMC…` id and a `PPR…` preprint id, each of which
 * comes back as exactly one record carrying the id it was asked about. `SRC`
 * is deliberately not paired with it — the id alone is unambiguous across the
 * sources, and pairing would mean storing a source this service never kept.
 */
export function translateId(nativeId: string): string {
  return `EXT_ID:${quote(nativeId)}`;
}

/** A year bound, in the range syntax the comment below explains is the only one that works. */
function yearRange({ from, to }: YearRange): string {
  return `PUB_YEAR:[${from ?? '*'} TO ${to ?? '*'}]`;
}

/**
 * Europe PMC's vocabulary for the query grammar's fields.
 *
 * `topic` keeps the three-field spread `scoped` already used and the header
 * above already justifies with measurements. The rest are Europe PMC's
 * documented index names.
 *
 * Two concepts get nothing and are deliberately left to widen. `publisher` has
 * no index here — Europe PMC describes journals, not imprints — and `all` is
 * the whole index, which is what a bare unscoped value already searches.
 */
const FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: ['TITLE_ABS', 'MESH', 'KW'],
  title: ['TITLE'],
  abstract: ['ABSTRACT'],
  author: ['AUTH'],
  venue: ['JOURNAL']
};

const DIALECT: Dialect = {
  fields: field => FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  // Wildcards pass through: Europe PMC supports `*` natively. A bare term
  // needs no escaping — the tokenizer already refused it the characters that
  // would need it.
  term: text => text.trim(),
  phrase: text => quote(text),
  years: range => yearRange(range),
  doi: value => `DOI:${quote(value)}`,
  unscoped: value => value,
  supportsNot: true
};

/** The query as it reached this provider before the grammar existed. */
function flatClauses(query: Query): string[] {
  const clauses: string[] = [];

  // Phrases are always required; only bare terms honour `join`.
  const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));
  const terms = query.terms.filter(t => t.trim()).map(t => scoped(t.trim()));

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the clauses beside it —
    // `a OR b AND OPEN_ACCESS:y` does not mean what it looks like.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }
  clauses.push(...phrases);

  return clauses;
}

export function translate(query: Query, options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    clauses.push(`DOI:${quote(query.doi)}`);
  } else {
    // The parsed query when there is one, and what this provider used to
    // receive when there is not. `renderExpression` returning nothing means
    // none of the query could be expressed here, which the flat form —
    // deliberately wider than the query — still can.
    const rendered = query.expression ? renderExpression(query.expression, DIALECT) : undefined;
    if (rendered) clauses.push(rendered);
    else clauses.push(...flatClauses(query));
  }

  // Range syntax, not comparison operators. Europe PMC accepts
  // `PUB_YEAR:>=2022` without complaint and then ignores it — measured, and
  // the failure is silent in the worst way: the hit count comes back identical
  // to the unbounded query, the page is the newest records in the whole
  // corpus, and the orchestrator's own year filter then discards every one of
  // them. A year-bounded search returned nothing at all.
  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(yearRange(query.years!));
  }

  if (options.openAccessOnly) clauses.push('OPEN_ACCESS:y');

  return clauses.join(' AND ');
}
