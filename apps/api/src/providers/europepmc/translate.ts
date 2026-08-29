import type { Query } from '@open-access-explorer/shared';

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

export function translate(query: Query, options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    clauses.push(`DOI:${quote(query.doi)}`);
  } else {
    // Phrases are always required; only bare terms honour `join`.
    const phrases = query.phrases.filter(p => p.trim()).map(quote);
    const terms = query.terms.filter(t => t.trim());

    if (terms.length > 0) {
      const joined = terms.join(` ${query.join} `);
      // Parenthesised so an OR join cannot swallow the clauses beside it —
      // `a OR b AND OPEN_ACCESS:y` does not mean what it looks like.
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
    clauses.push(...phrases);
  }

  // Range syntax, not comparison operators. Europe PMC accepts
  // `PUB_YEAR:>=2022` without complaint and then ignores it — measured, and
  // the failure is silent in the worst way: the hit count comes back identical
  // to the unbounded query, the page is the newest records in the whole
  // corpus, and the orchestrator's own year filter then discards every one of
  // them. A year-bounded search returned nothing at all.
  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(`PUB_YEAR:[${from ?? '*'} TO ${to ?? '*'}]`);
  }

  if (options.openAccessOnly) clauses.push('OPEN_ACCESS:y');

  return clauses.join(' AND ');
}
