import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> a PubMed search term. Pure, and the only place that knows this
 * API's syntax.
 *
 * PubMed applies an implicit AND between space-separated terms, so this
 * provider never had arXiv's problem of a multi-word search silently becoming
 * a disjunction. Being explicit costs nothing and means the query says what it
 * means.
 */

/** Open ends of a date range. PubMed wants two bounds, and these are its conventional ones. */
const EARLIEST = 1800;
const LATEST = 3000;

/**
 * PubMed has no `"open access"[Filter]`, and quoting a filter it does not know
 * turns it into a literal phrase that matches nothing — which is how this
 * query once returned zero results in silence. This is the real subset name.
 */
const OPEN_ACCESS = 'pubmed pmc open access[filter]';

function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

export type TranslateOptions = {
  /** Restrict to the PMC open-access subset. */
  openAccessOnly?: boolean;
};

export function translate(query: Query, options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    // Quoted because a DOI contains slashes and dots that PubMed would
    // otherwise try to tokenise.
    clauses.push(`${quote(query.doi)}[DOI]`);
  } else {
    const terms = query.terms.filter(t => t.trim()).map(t => t.trim());
    const phrases = query.phrases.filter(p => p.trim()).map(quote);

    if (terms.length > 0) {
      const joined = terms.join(` ${query.join} `);
      // Parenthesised so an OR join cannot swallow the clauses beside it.
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
    // Phrases are always required, whatever `join` says about the bare terms.
    clauses.push(...phrases);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(`${from ?? EARLIEST}:${to ?? LATEST}[PDAT]`);
  }

  if (options.openAccessOnly) clauses.push(OPEN_ACCESS);

  return clauses.join(' AND ');
}
