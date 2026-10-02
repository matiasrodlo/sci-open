import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the DataCite search string. Pure, and the only place that knows
 * this API's syntax.
 *
 * The old connector sent `titles.title:*crispr gene editing*` — a
 * leading-wildcard match against the title field alone. Leading wildcards are
 * the expensive shape for the Elasticsearch behind this API, and restricting
 * to titles discards abstract matches: 2,412 hits that way against 6,003 for
 * the same words searched across the record.
 */

/** DataCite accepts a wildcard range endpoint, unlike arXiv and DOAJ. */
const OPEN_END = '*';

function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. DataCite is a DOI registry, not a full-text host,
   * and reports no access status to filter on — which is the whole of why its
   * records rarely survive a retrievability filter.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    clauses.push(`doi:${quote(query.doi)}`);
  } else {
    const terms = query.terms.filter(t => t.trim()).map(t => t.trim());
    const phrases = query.phrases.filter(p => p.trim()).map(quote);

    if (terms.length > 0) {
      const joined = terms.join(` ${query.join} `);
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
    clauses.push(...phrases);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(`publicationYear:[${from ?? OPEN_END} TO ${to ?? OPEN_END}]`);
  }

  return clauses.join(' AND ');
}
