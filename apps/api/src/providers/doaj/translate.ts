import type { Query, QueryField } from '@open-access-explorer/shared';
import { cannotSend, flatTerms, nameAsWords, renderExpression, type Dialect } from '../render-query';

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

/** A phrase, with DOAJ's quoting rules applied. */
function quoted(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * DOAJ's `bibjson` paths for the query grammar.
 *
 * `topic` keeps the title/abstract/keywords spread `FIELDS` already declares.
 *
 * `all` and `publisher` widen to the union below rather than to a bare
 * unscoped value. DOAJ's search is Elasticsearch `query_string` over a default
 * field, and which field that is is DOAJ's choice rather than something this
 * code can assert — so the widening is spelled out in paths already in use
 * here, where what it searches is a fact rather than a hope.
 */
const QUERY_FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: FIELDS,
  title: ['bibjson.title'],
  abstract: ['bibjson.abstract'],
  author: ['bibjson.author.name'],
  venue: ['bibjson.journal.title'],
  publisher: ['bibjson.journal.publisher']
};

const EVERY_FIELD = [
  'bibjson.title', 'bibjson.abstract', 'bibjson.keywords',
  'bibjson.author.name', 'bibjson.journal.title', 'bibjson.journal.publisher'
] as const;

/**
 * A term as DOAJ is sent it, or `''` for a wildcard, which it cannot run.
 *
 * `escape` turned `*` and `?` into literal characters, so a wildcard was
 * searched as text. Measured with `bibjson.title:` on 2026-09-30:
 *
 *   generation 51,814   generat\* 1      genome 51,150   genom\* 87
 *   generating  4,899   gene\*ing 2      gene   99,394   ge\*    1,691
 *
 * Unescaped, DOAJ refuses every one of them — HTTP 400 — so there is no form
 * of a wildcard it answers. In a title, abstract, author, journal or publisher
 * clause the term is left out, which widens the query, and `matchesQuery`
 * applies it to what comes back; as a topic term, which `matchesQuery` never
 * convicts on, DOAJ is not asked at all — see `cannotSend` and `flatTerms`.
 */
function sendable(term: string): string {
  return /[*?]/.test(term) ? '' : escape(term);
}

const DIALECT: Dialect = {
  fields: field => QUERY_FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  // Empty for a wildcard, which `renderExpression` then drops.
  term: text => sendable(text.trim()),
  phrase: text => quoted(text),
  years: ({ from, to }) => `bibjson.year:[${from ?? EARLIEST} TO ${to ?? LATEST}]`,
  doi: value => `bibjson.identifier.id:"${escape(value)}"`,
  unscoped: value => `(${EVERY_FIELD.map(field => `${field}:${value}`).join(' OR ')})`,
  supportsNot: true,
  // DOAJ indexes an author's name word by word, so a name is its words. See
  // `nameAsWords`.
  authorName: words => nameAsWords(words, DIALECT)
};

/** The query as it reached this provider before the grammar existed. */
function flatClauses(query: Query): string[] {
  const clauses: string[] = [];

  // A flat query with a wildcard in it is not asked at all. See `flatTerms`.
  const kept = flatTerms(query, sendable);
  if (!kept) return [];

  const terms = kept.map(anyField);
  const phrases = query.phrases.filter(p => p.trim()).map(p => anyField(quoted(p)));

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the clauses beside it. The
    // old connector emitted `title:x OR abstract:x OR keywords:x AND (years)`
    // unbracketed, where the AND binds to the last clause alone.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }

  // Phrases are always required, whatever `join` says about the bare terms.
  clauses.push(...phrases);

  return clauses;
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

  // A topic term this provider cannot send, and cannot leave out, asks nothing.
  // See `cannotSend`.
  if (query.expression && cannotSend(query.expression, DIALECT)) return '';
  const rendered = query.expression ? renderExpression(query.expression, DIALECT) : undefined;
  const searched = rendered ? [rendered] : flatClauses(query);
  // Nothing left to search for asks nothing. A year range on its own would ask
  // DOAJ for everything published in it.
  if (searched.length === 0) return '';
  clauses.push(...searched);

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    // One range with two real endpoints, AND-ed. The old connector joined its
    // two bounds with OR, which matches everything either side of them.
    clauses.push(`bibjson.year:[${from ?? EARLIEST} TO ${to ?? LATEST}]`);
  }

  return clauses.join(' AND ');
}
