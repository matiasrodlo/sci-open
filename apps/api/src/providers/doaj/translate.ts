import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the DOAJ article search string. Pure, and the only place that knows
 * this API's syntax.
 *
 * Every field name here is fully qualified, and that is not stylistic. DOAJ
 * accepts an unqualified field it does not know and answers HTTP 200 with zero
 * results — measured: `keywords:crispr` returns 0 while
 * `bibjson.keywords:crispr` returns 8,467, and `year:2022` returns 0 while
 * `bibjson.year:2022` returns 1,153,036. The old connector used both of the
 * dead spellings, so a third of its OR clause matched nothing on every search
 * and its year filter could not have worked even without the syntax error
 * beside it.
 */

/** The fields a bare term is searched across. */
const FIELDS = ['bibjson.title', 'bibjson.abstract', 'bibjson.keywords'] as const;

/**
 * Concrete endpoints for a half-open range. DOAJ rejects a wildcard one with
 * HTTP 400 — the same trap as arXiv, which answers 500 for the same shape.
 */
const EARLIEST = 1500;
const LATEST = 3000;

/** Lucene-ish syntax: these would otherwise be read as operators. */
function escape(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

/** One term, searched across every field, as a single parenthesised clause. */
function anyField(value: string): string {
  return `(${FIELDS.map(field => `${field}:${value}`).join(' OR ')})`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. DOAJ indexes only fully open-access journals — that
   * is what the directory is — so there is no subset to narrow to.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    return `bibjson.identifier.id:"${escape(query.doi)}"`;
  }

  const terms = query.terms.filter(t => t.trim()).map(t => anyField(escape(t.trim())));
  const phrases = query.phrases
    .filter(p => p.trim())
    .map(p => anyField(`"${p.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`));

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the clauses beside it. The
    // old connector emitted `title:x OR abstract:x OR keywords:x AND (years)`
    // unbracketed, where the AND binds to the last clause alone.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }

  // Phrases are always required, whatever `join` says about the bare terms.
  clauses.push(...phrases);

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    // One range with two real endpoints, AND-ed. The old connector joined its
    // two bounds with OR, which matches everything either side of them.
    clauses.push(`bibjson.year:[${from ?? EARLIEST} TO ${to ?? LATEST}]`);
  }

  return clauses.join(' AND ');
}
