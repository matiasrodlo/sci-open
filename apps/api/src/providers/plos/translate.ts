import type { Query, QueryField } from '@open-access-explorer/shared';
import { renderExpression, type Dialect } from '../render-query';

/**
 * Query -> the PLOS Solr query string. Pure, and the only place that knows
 * this API's syntax.
 *
 * `everything:crispr gene editing` and the explicitly AND-ed form were once
 * measured returning the same 5,940, and read as "this provider never had
 * arXiv's disjunction problem". The equality was real and the reading was
 * luck: `everything` is Solr's *default* field here, so the words after the
 * first fell into it anyway and the prefix was doing nothing either way.
 *
 * That stopped being true the moment the search was scoped — `title:gene
 * editing` matches 7,301 and `title:"gene editing"` matches 44 — which is why
 * `scoped` below prefixes every term rather than trusting one prefix to carry
 * the clause.
 */

/**
 * The fields a search for a subject means.
 *
 * `everything` was here, and for PLOS that is not a figure of speech — PLOS
 * publishes its own full text and indexes it, so `everything:` behaves exactly
 * like the OpenAlex `search` parameter this provider's neighbour moved away
 * from. Measured on `crispr gene editing` against the research-article filter:
 * **5,563** matches through `everything`, **359** in the title or abstract.
 *
 * `subject` is in the list for the same reason Europe PMC's `MESH` and
 * PubMed's `[mh]` are: it is the subject index, and dropping it would be a
 * loss rather than a noise cut. Here it recovers 2 records of 361 where Europe
 * PMC's recovers a tenth of the set — the rule is the same, the yield is a
 * property of how each corpus is indexed.
 */
const FIELDS = ['title', 'abstract', 'subject'] as const;

/** PLOS indexes from 2003; the ends of an open range have to be real dates. */
const EARLIEST = '2000-01-01T00:00:00Z';
const LATEST = '9999-12-31T23:59:59Z';

function quote(phrase: string): string {
  // Inside quotes a backslash is still an escape: `"gene\editing"` found
  // nothing where `"gene\\editing"` finds the 51 `"gene editing"` does.
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\')}"`;
}

/**
 * The characters Solr's query parser reads as syntax, less `*` and `?` — the
 * grammar's wildcards, which are sent as wildcards — and less the whitespace,
 * parentheses and quotes a term cannot contain, since the grammar splits on
 * them.
 */
const SOLR_SYNTAX = /[\\+\-!:^[\]{}~|&/]/g;

/**
 * A term as text rather than as query syntax.
 *
 * Nothing was escaped, so whatever a term carried reached the parser as syntax.
 * Measured against api.plos.org with `title:` on 2026-09-30:
 *
 *   [crispr]  crispr{}  a:b  -crispr  +crispr  !crispr   HTTP 400
 *   a\b                           0 results: the backslash escaped the `b`
 *   crispr~  crispr^2             a fuzzy search (884, against 445), a boost
 *
 * The 400s took PLOS out of the search, reported as its failure. Escaped, each
 * asks for the text it spells: `\[crispr\]`, `\-crispr` and `\!crispr` all find
 * the 445 that `crispr` does, and `a\\b` finds 51.
 *
 * A term with no letter or digit in it is left out instead. Escaped, `-` asks
 * for nothing and finds nothing — narrower than the query, where leaving it out
 * widens it, and `matchesQuery` applies it to what comes back.
 */
function escaped(term: string): string {
  return /[\p{L}\p{N}]/u.test(term) ? term.replace(SOLR_SYNTAX, '\\$&') : '';
}

/**
 * One search word or quoted phrase, across the fields above.
 *
 * Per term, not one group wrapping the query, because a Solr field prefix
 * binds to the token after it and nothing else. Measured: `title:gene editing`
 * matches **7,301** — `gene` in the title and `editing` loose in the default
 * field — where `title:"gene editing"` matches **44**. A query scoped on its
 * first word and unscoped on the rest is worse than one that was never scoped,
 * and it looks fine from the outside.
 */
function scoped(value: string): string {
  return `(${FIELDS.map(field => `${field}:${value}`).join(' OR ')})`;
}

/**
 * Both ends explicit. The old connector defaulted a missing lower bound to the
 * year 2000 and a missing upper bound to the current year — two invented bounds
 * that silently excluded anything outside them.
 */
function publicationDate({ from, to }: { from?: number; to?: number }): string {
  const start = from !== undefined ? `${from}-01-01T00:00:00Z` : EARLIEST;
  const end = to !== undefined ? `${to}-12-31T23:59:59Z` : LATEST;
  return `publication_date:[${start} TO ${end}]`;
}

/**
 * PLOS's Solr fields for the query grammar.
 *
 * `topic` keeps the title/abstract/subject spread `FIELDS` already declares.
 *
 * `all` and `publisher` are the union of everything named here rather than a
 * Solr catch-all. PLOS does document an `everything` field, and this code does
 * not use it: an unverified field name that turns out not to exist is a 400
 * from the provider, which the orchestrator reports as a failed source and a
 * lower-bound total. The union is wider than any single clause could need,
 * costs one more `OR`, and every name in it is already in use above.
 */
const QUERY_FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: FIELDS,
  title: ['title'],
  abstract: ['abstract'],
  author: ['author'],
  venue: ['journal']
};

const EVERY_FIELD = ['title', 'abstract', 'subject', 'author', 'journal'] as const;

const DIALECT: Dialect = {
  fields: field => QUERY_FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  // Empty for a term with nothing to search for, which `renderExpression` drops.
  term: text => escaped(text.trim()),
  phrase: text => quote(text),
  years: range => publicationDate(range),
  // `id`, not `doi` — see the note in `translate`.
  doi: value => `id:${quote(value)}`,
  unscoped: value => `(${EVERY_FIELD.map(field => `${field}:${value}`).join(' OR ')})`,
  supportsNot: true
};

/** The query as it reached this provider before the grammar existed. */
function flatClauses(query: Query): string[] {
  const clauses: string[] = [];

  const words = query.terms.map(t => t.trim()).filter(Boolean);
  const kept = words.map(escaped).filter(Boolean);
  // Leaving out a required term widens the query; leaving out an alternative
  // narrows it. So an OR with a term left out is not asked at all — phrases
  // included, which are sent below as required.
  if (query.join === 'OR' && kept.length < words.length) return [];

  const terms = kept.map(scoped);
  const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the date clause beside it.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }
  clauses.push(...phrases);

  return clauses;
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
    const rendered = query.expression ? renderExpression(query.expression, DIALECT) : undefined;
    const searched = rendered ? [rendered] : flatClauses(query);
    // Nothing left to search for asks nothing. A date range on its own would
    // ask PLOS for everything published in it.
    if (searched.length === 0) return '';
    clauses.push(...searched);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(publicationDate(query.years!));
  }

  return clauses.join(' AND ');
}
