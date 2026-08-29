import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the PLOS Solr query string. Pure, and the only place that knows
 * this API's syntax.
 *
 * `everything:` already treats space-separated terms as required — measured,
 * `everything:crispr gene editing` and the explicitly AND-ed form both return
 * 5,940 — so this provider never had arXiv's disjunction problem. Being
 * explicit costs nothing and makes the query say what it means.
 */

const FIELD = 'everything';

/** PLOS indexes from 2003; the ends of an open range have to be real dates. */
const EARLIEST = '2000-01-01T00:00:00Z';
const LATEST = '9999-12-31T23:59:59Z';

function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. Every PLOS journal is fully open access, so there is
   * no subset to narrow to.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    // `id`, not `doi`. A PLOS article's id *is* its DOI, and there is no `doi`
    // field — asking for one returns the entire corpus rather than an error:
    // `doi:"10.1371/journal.pgen.1002441"` matched 64,432 documents where
    // `id:"..."` matches exactly the one. The old connector used `doi:`, so
    // every PLOS DOI lookup answered with an arbitrary page of the corpus.
    clauses.push(`id:${quote(query.doi)}`);
  } else {
    const terms = query.terms.filter(t => t.trim()).map(t => `${FIELD}:${t.trim()}`);
    const phrases = query.phrases.filter(p => p.trim()).map(p => `${FIELD}:${quote(p)}`);

    if (terms.length > 0) {
      const joined = terms.join(` ${query.join} `);
      // Parenthesised so an OR join cannot swallow the date clause beside it.
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
    clauses.push(...phrases);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    // Both ends are explicit. The old connector defaulted a missing lower
    // bound to the year 2000 and a missing upper bound to the current year —
    // two invented bounds that silently excluded anything outside them.
    const start = from !== undefined ? `${from}-01-01T00:00:00Z` : EARLIEST;
    const end = to !== undefined ? `${to}-12-31T23:59:59Z` : LATEST;
    clauses.push(`publication_date:[${start} TO ${end}]`);
  }

  return clauses.join(' AND ');
}
