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

/**
 * One search word, scoped to the title, the abstract and the MeSH headings.
 *
 * Unscoped, PubMed searches *every* field, and the panel's count said so
 * without saying so. Measured on `ai`: 287,637 records match unscoped and
 * 60,399 match in the title or abstract — the other 227,238 are matches on an
 * author's name (16,910 papers have an author surnamed Ai), an affiliation, a
 * journal title. Beside OpenAlex and DOAJ in the same list, that number was
 * answering a different question from theirs.
 *
 * `[mh]` is in the scope and `[tiab]` alone is not, because dropping the
 * subject index would be a real loss rather than a noise cut. Measured on
 * `crispr`, where the indexing is doing work: 37,290 unscoped, 34,557 in
 * `[tiab]`, 34,719 with `[mh]` beside it — the MeSH clause costs nothing and
 * recovers the records indexed under the heading whose abstract never spells
 * it out. So the trade is 7% on a subject term against 79% of noise on a term
 * that is also a surname.
 *
 * A word that is no MeSH heading is not an error: PubMed reports it in
 * `phrasesnotfound` and matches nothing on that side of the OR, which is
 * exactly right when the `[tiab]` side is carrying the query.
 */
function scoped(term: string): string {
  return `(${term}[tiab] OR ${term}[mh])`;
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
    const terms = query.terms.filter(t => t.trim()).map(t => scoped(t.trim()));
    const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));

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
