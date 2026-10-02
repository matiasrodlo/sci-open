import type { PaperStage, Query, QueryField, YearRange } from '@open-access-explorer/shared';
import { cannotSend, flatTerms, joinFlat, nameAsWords, renderExpression, type Dialect } from '../render-query';
import { STAGES } from './normalize';

/**
 * Query -> the HAL Solr query string. Pure, and the only place that knows this
 * API's syntax.
 *
 * HAL's search is a Solr index with a field per language and per spelling.
 * The `_t` fields are the analysed ones — case and accents folded, words
 * split — and the ones searched here; the `_s` fields are the stored strings
 * `normalize` reads and the facets count.
 *
 * Measured against api.archives-ouvertes.fr on 2026-10-01 unless noted.
 */

/**
 * The fields a search for a subject means: the title, the abstract and the
 * author's keywords, in every language they were deposited in.
 *
 * Not HAL's catch-all `text`, for the reason PLOS's `everything` went: it
 * reaches further than the title and abstract the other providers search, and
 * a count beside theirs would be a different question. On `crispr`: 380 in the
 * title, 1,606 in the abstract, 582 in the keywords, 1,815 through `text`.
 */
const FIELDS = ['title_t', 'abstract_t', 'keyword_t'] as const;

/**
 * Inside quotes a backslash is still an escape, as on PLOS. A wildcard is not
 * one: `title_t:"gene edit*"` finds 0 records, so a `*` or `?` in a phrase
 * would narrow it to nothing. They go, as the quotes do, which asks for the
 * words around them — wider, and `matchesQuery` holds what comes back to the
 * phrase as written.
 */
function quote(phrase: string): string {
  return `"${phrase.replace(/["*?]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\')}"`;
}

/** A value matched whole, on a string field: a DOI or a HAL id. */
function exact(value: string): string {
  return `"${value.trim().replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * The characters Solr's query parser reads as syntax, less the wildcards — see
 * `sendable` — and less what a term cannot contain. PLOS's list, and HAL's
 * parser refuses the same things: `[crispr]`, `crispr{}`, `a:b` and `-crispr`
 * all answer with an error, and `crispr~` is a fuzzy search, 11,762 records
 * against 804. Escaped, `\[crispr\]` and `\-crispr` find the 804 `crispr` does.
 */
const SOLR_SYNTAX = /[\\+\-!:^[\]{}~|&/]/g;

function escaped(term: string): string {
  return /[\p{L}\p{N}]/u.test(term) ? term.replace(SOLR_SYNTAX, '\\$&') : '';
}

/**
 * A term as HAL is sent it, or `''` for one it cannot run faithfully.
 *
 * Wildcards pass through, which is where HAL parts company with PLOS. HAL's
 * index is not stemmed — `generation` 19,579, `generations` 1,593,
 * `generating` 1,718 — so a pattern is matched against the words as written,
 * and folded the way the words were:
 *
 *   generat*  Generat*  GENERAT*   33,295 each
 *   ecolog*   écolog*              21,182 each
 *   genome 8,892   gen?me 8,893   genom* 18,334   gene*ing 1,951
 *
 * Leading wildcards run too: `*ology` finds 77,537.
 *
 * Not where the term carries anything but letters and digits around its
 * wildcards. HAL splits `covid-19` into two words, and `covid-19*` then finds
 * 13,750 against the 15,039 `covid-19` does — fewer, from a pattern that
 * should only ever find more. Such a term is not sent; `flatTerms` and
 * `cannotSend` decide what that means for the rest of the query.
 */
function sendable(term: string): string {
  if (!/[*?]/.test(term)) return escaped(term);
  return /^[\p{L}\p{N}*?]+$/u.test(term) && /[\p{L}\p{N}]/u.test(term) ? term : '';
}

/** One search word or quoted phrase, across `FIELDS`. A Solr prefix binds one token. */
function scoped(value: string): string {
  return `(${FIELDS.map(field => `${field}:${value}`).join(' OR ')})`;
}

/**
 * `producedDateY_i`, HAL's own year, and the one `normalize` and the facets
 * read. Present on every record read; for journal articles it agreed with
 * `publicationDateY_i` on all 61,644 from 2020.
 */
function yearRange({ from, to }: YearRange): string {
  return `producedDateY_i:[${from ?? '*'} TO ${to ?? '*'}]`;
}

/**
 * HAL's `_t` field for each concept the grammar can name.
 *
 * Every one of these answers with records — but that is the check, not the
 * fact that HAL accepts the name: an unknown `_t` field is a dynamic field and
 * matches nothing rather than failing. `nosuchfield_t:x` answers 0. A misspelt
 * field here would be a provider that silently finds nothing for a clause.
 * Measured: `journalTitle_t:nature` 9,806, `conferenceTitle_t:workshop`
 * 20,071, `bookTitle_t:handbook` 1,187, `journalPublisher_t:elsevier` 143,670,
 * `publisher_t:springer` 33,853.
 *
 * A venue is the journal, the conference or the book, because `normalize`
 * takes whichever of the three a record has; a publisher is the journal's or,
 * for a book, the book's.
 */
const QUERY_FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: FIELDS,
  title: ['title_t'],
  abstract: ['abstract_t'],
  author: ['authFullName_t'],
  venue: ['journalTitle_t', 'conferenceTitle_t', 'bookTitle_t'],
  publisher: ['journalPublisher_t', 'publisher_t']
};

/** `all`, and anything else with no field of its own: every field above. */
const EVERY_FIELD = [...new Set(Object.values(QUERY_FIELDS).flat())];

const DIALECT: Dialect = {
  fields: field => QUERY_FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  // Empty for a term with nothing to search for, which `renderExpression` drops.
  term: text => sendable(text.trim()),
  phrase: text => quote(text),
  years: range => yearRange(range),
  doi: value => `doiId_s:${exact(value)}`,
  unscoped: value => `(${EVERY_FIELD.map(field => `${field}:${value}`).join(' OR ')})`,
  // `title_t:crispr AND NOT (title_t:plant)` finds 786 of the 804.
  supportsNot: true,
  // HAL keeps a name as its words, forename first: `"Cédric Villani"` finds
  // 12, the words 13, and `"Villani Cédric"` none. See `nameAsWords`.
  authorName: words => nameAsWords(words, DIALECT)
};

/** The query as it reached a provider before the grammar existed. */
function flatClauses(query: Query): string[] {
  // A flat query with a term it cannot run is not asked at all. See `flatTerms`.
  const kept = flatTerms(query, sendable);
  if (!kept) return [];

  const terms = kept.map(scoped);
  const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));

  // Grouped, and under an OR the phrases are alternatives too. See `joinFlat`.
  return joinFlat(terms, phrases, query.join);
}

/**
 * The document types that are the stages asked for, as a clause — nothing when
 * every type read is among them, and `false` when none is, since HAL holds
 * nothing to ask for then.
 *
 * Built from `STAGES`, so what is asked for and what `normalize` calls it
 * cannot drift apart.
 */
function stageClause(stages: readonly PaperStage[] | undefined): string | undefined | false {
  if (!stages?.length) return undefined;
  const all = Object.keys(STAGES);
  const kept = all.filter(type => stages.includes(STAGES[type]!));
  if (kept.length === 0) return false;
  if (kept.length === all.length) return undefined;
  return `docType_s:(${kept.join(' OR ')})`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. Every record is read from the files HAL serves
   * openly — see `READ` in `fetch.ts` — so there is no subset to narrow to.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    clauses.push(`doiId_s:${exact(query.doi)}`);
  } else {
    // A topic term this provider cannot send, and cannot leave out, asks nothing.
    // See `cannotSend`.
    if (query.expression && cannotSend(query.expression, DIALECT)) return '';
    const rendered = query.expression ? renderExpression(query.expression, DIALECT) : undefined;
    const searched = rendered ? [rendered] : flatClauses(query);
    // Nothing left to search for asks nothing. A year range on its own would
    // ask HAL for everything deposited in it.
    if (searched.length === 0) return '';
    clauses.push(...searched);

    const stage = stageClause(query.stages);
    if (stage === false) return '';
    if (stage) clauses.push(stage);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    clauses.push(yearRange(query.years!));
  }

  return clauses.join(' AND ');
}

/**
 * One record's own id -> the query that retrieves exactly it.
 *
 * Separate from `translate` for the reason Europe PMC's is: a HAL id arriving
 * as a bare term would be searched for in the title, the abstract and the
 * keywords, none of which contain it. `halId_s:hal-04020890` finds the one
 * record.
 */
export function translateId(nativeId: string): string {
  return `halId_s:${exact(nativeId)}`;
}
