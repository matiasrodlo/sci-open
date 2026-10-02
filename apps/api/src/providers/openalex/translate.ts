import type { PaperStage, Query, QueryField, QueryNode, QueryValue } from '@open-access-explorer/shared';
import { fieldsUsed } from '@open-access-explorer/shared';
import { dropsForGood, flatStatesWhole, isInitial } from '../render-query';
import { STAGES } from './normalize';

/**
 * Query -> OpenAlex's request parameters.
 *
 * Like OpenAIRE, OpenAlex has no single query string: a search is a `search`
 * term plus a comma-separated `filter`. So `translate` returns a canonical
 * serialisation of those parameters, which is what the orchestrator needs it
 * for — the provider cache keys on it, and a key that left the year bounds out
 * would serve a 2022–2024 search from an unbounded one.
 */

/**
 * Ends of a half-open range.
 *
 * The old path emitted `publication_year:>=2022,publication_year:<=2024`, which
 * OpenAlex rejects outright: **HTTP 400**, `"Value for param publication_year
 * must be a number."` So every year-bounded search lost its largest provider —
 * and that was invisible until the 429 fix made a non-2xx throw, because
 * `validateStatus: status < 500` had been resolving the 400 as a success.
 *
 * `>` and `<` do work, but a range with two concrete endpoints is one clause
 * instead of two and was verified to return exactly the same counts: 78,150 for
 * `2024-9999` and `>2023` alike, 61,925 for `1000-2021` and `<2022`.
 */
const EARLIEST = 1000;
const LATEST = 9999;

export type OpenAlexParams = {
  /** Comma-separated, OpenAlex's own syntax. Everything goes here. */
  filter?: string;
};

/**
 * OpenAlex reads `,` as the separator between filters and `|` as OR *within*
 * one, so neither can survive inside a search value — a query for `crispr,
 * cas9` would be read as two filters and the second one would not parse.
 *
 * Spaces, because the alternative is dropping the words either side of the
 * comma together. There is no documented escape.
 */
function filterSafe(value: string): string {
  return value.replace(/[,|]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A phrase, quoted — with the quotes inside it removed first.
 *
 * Every other provider's translate does this and OpenAlex's did not, because
 * the value used to go out as its own `search` parameter where an unbalanced
 * quote was merely a bad search. Inside a filter it is a malformed filter.
 */
function quote(phrase: string): string {
  const inner = phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  return inner ? `"${inner}"` : '';
}

/**
 * Whether OpenAlex will run this wildcard term on `title_and_abstract.search.exact`.
 *
 * Only there: the stemmed `title_and_abstract.search` answers any `*` or `?`
 * with **HTTP 400**, "Wildcards (* or ?) require the exact (no-stem) field" —
 * which every wildcard search met, so none of them was ever complete, and none
 * was held. The rules of the exact field are undocumented and were measured
 * against the live API on 2026-09-29:
 *
 *   gen*  gene*ing  abc*def*  gen**  g?ne  ge?e  x_y*   answered
 *   *ing  ?ene          400, "Leading wildcards are not supported"
 *   ge*  gen?m*  ge?e*  400, "A * wildcard needs at least 3 leading characters"
 *   covid-19*  c++*     400: the engine splits at the punctuation and the `*`
 *                       is left on a fragment too short to carry it
 *
 * So letters, digits and `_` with no wildcard first, and three of them, with
 * no `?` among them, ahead of any `*`.
 */
function exactRunnable(term: string): boolean {
  if (!/^[A-Za-z0-9_*?]+$/.test(term) || /^[*?]/.test(term)) return false;
  const star = term.indexOf('*');
  return star === -1 || /^[A-Za-z0-9_]{3,}$/.test(term.slice(0, star));
}

/**
 * A `type:` filter selecting the works `normalize` gives one of these stages.
 *
 * `unknown` is every type `STAGES` does not name — `dataset`, `review`,
 * `conference-paper` and the rest — so a set that includes it is written as
 * the types to leave out rather than the ones to keep. Empty when no type can
 * carry any of the stages asked for; the caller asks nothing then.
 */
function typeFilters(stages: readonly PaperStage[]): string[] | undefined {
  const types = Object.keys(STAGES).sort();

  if (stages.includes('unknown')) {
    return types.filter(type => !stages.includes(STAGES[type]!)).map(type => `type:!${type}`);
  }

  const kept = types.filter(type => stages.includes(STAGES[type]!));
  return kept.length > 0 ? [`type:${kept.join('|')}`] : undefined;
}

/**
 * OpenAlex's filter key for each field the grammar can name, and the five it
 * has one for.
 *
 * Measured against the live API on 2026-09-30, since a filter key OpenAlex does
 * not recognise is an **HTTP 400** for the whole request and so costs the
 * largest provider in the fan-out:
 *
 *   title.search  abstract.search  title_and_abstract.search
 *   raw_author_name.search  default.search                        200
 *
 *   primary_location.source.display_name[.search]                 400
 *   primary_location.source.publisher.search                      400
 *   primary_location.source.host_organization_name[.search]       400
 *   locations.source.display_name.search                          400
 *   host_venue.display_name.search                                400
 *   journal.search                                                400
 *   authorships.institutions.display_name.search                  400
 *
 * Ten candidates, so the absence is the finding rather than a gap in the
 * search for one: OpenAlex has no filter that takes a venue or publisher
 * *name*. `primary_location.source.issn` does work, which is the route if this
 * is ever wanted — resolve the name through the `/sources` endpoint first — and
 * that is a request per clause and a disambiguation problem, not a mapping.
 *
 * So `SO=` and `PU=` have no key here and are left to widen: a clause on either
 * is dropped from the request and applied by `matchesQuery` over the merged
 * records instead. A query that is *only* `SO=` therefore translates to
 * nothing, and `fanOut` reports OpenAlex skipped rather than letting it answer
 * `0` to a question it was never asked.
 */
const FIELD_FILTERS: Partial<Record<QueryField, string>> = {
  topic: 'title_and_abstract.search',
  title: 'title.search',
  abstract: 'abstract.search',
  author: 'raw_author_name.search',
  all: 'default.search'
};

/**
 * Whether the query names a field, as opposed to being words about a subject.
 *
 * `topic` is what an untagged word means and keeps the flat path below, which
 * is where every measurement in this file was taken.
 *
 * `ALL=` counts as naming one, and that is not a technicality. The flat path
 * sends `title_and_abstract.search`, so an explicit "search every field" would
 * have been answered by two of them — measured on `crispr`, 136,418 against
 * 383,293 for `default.search`. That is a quarter of a million records the
 * query asked for and nothing would have fetched, which is the direction this
 * translator is never allowed to be wrong in.
 *
 * `year` and `doi` are lifted onto `Query` before this and have filters of
 * their own.
 */
function usesScopedField(expression: QueryNode): boolean {
  return [...fieldsUsed(expression)].some(
    field => field !== 'topic' && field !== 'year' && field !== 'doi'
  );
}

/**
 * One clause's value, or nothing when OpenAlex cannot carry it.
 *
 * Wildcards are refused rather than attempted. `title_and_abstract.search`
 * answers any `*` or `?` with HTTP 400 and only the `.search.exact` variant
 * runs them — and whether the other four keys have an exact variant at all is
 * not something this code has measured; a guessed filter key fails the whole
 * search. `clauseFilter` sends a topic wildcard to the one exact key that is
 * measured, and `fieldFilters` decides what an unsent clause costs.
 */
function clauseValue(value: QueryValue): string | undefined {
  if (value.kind === 'years') return undefined;

  /**
   * `filterSafe` after quoting, exactly as the flat path below does it, and for
   * a reason the quotes do not protect against: `,` and `|` keep their meaning
   * to OpenAlex *inside* a quoted value.
   *
   * Measured on the live API, `title.search` over open works:
   *
   *   "gene editing"   8,171   the phrase
   *   "gene|editing"   1,763,137
   *
   * The pipe is read as OR between the halves, so the phrase quietly becomes a
   * query for either word — two hundred times the records, answered 200 with
   * nothing to say anything had gone wrong, and the whole depth budget spent on
   * a question nobody asked. A comma parsed harmlessly in the one case measured,
   * but it is the filter separator and is stripped on the same grounds.
   *
   * Stripped *before* quoting rather than after, which the flat path cannot do
   * because it quotes each phrase and cleans the joined result once. Done the
   * other way round, a phrase that was nothing but separators survives as
   * `title.search:" "` — a filter asking for a quoted space — instead of
   * disappearing and letting the clause widen.
   */
  if (value.kind === 'phrase') return quote(filterSafe(value.text)) || undefined;

  if (/[*?]/.test(value.text)) return undefined;
  return filterSafe(value.text) || undefined;
}

/**
 * An author phrase as the words of the name, unquoted, or nothing where it has
 * no word to send but initials.
 *
 * Quoted, `raw_author_name.search` wants the words adjacent and in that order,
 * and the sources OpenAlex reads write a name every way round. Measured live
 * on 2026-10-01 over open works: `"Doudna Jennifer"` 13, `"Jennifer Doudna"`
 * 37, and unquoted — which OpenAlex reads as every word required — 488 in
 * either order. Initials are left out for the same reason: `Doudna J` is 191,
 * the records that happen to give her as an initial, where `matchesQuery`
 * accepts the 488 that give her forename. Every word sent is a word of the
 * phrase, so this asks for more than the phrase did and never less.
 */
function authorPhraseValue(text: string): string | undefined {
  const names = text.split(/[\s,]+/).filter(word => word && !isInitial(word));
  if (names.length === 0 || names.some(word => /[*?]/.test(word))) return undefined;
  return filterSafe(names.join(' ')) || undefined;
}

/** The `AND` spine, flattened — the clauses every result must satisfy. */
function conjuncts(node: QueryNode): QueryNode[] {
  return node.kind === 'and' ? node.nodes.flatMap(conjuncts) : [node];
}

/**
 * An `OR` OpenAlex can state: alternatives on one field, which is `|` inside a
 * single filter value. Measured — `title_and_abstract.search:crispr|cas9`
 * answered 141,022 against 136,418 for `crispr` alone.
 *
 * Alternatives across *different* fields have no form here, because separate
 * filters are ANDed. Those return nothing and the whole `OR` is dropped from
 * the request, which widens it — never the other way round, since a branch
 * dropped from an `OR` is records nobody would fetch and nothing could recover.
 */
function orFilter(node: Extract<QueryNode, { kind: 'or' }>): string | undefined {
  const values: string[] = [];
  let field: QueryField | undefined;

  for (const child of node.nodes) {
    if (child.kind !== 'clause') return undefined;
    if (field !== undefined && child.field !== field) return undefined;
    field = child.field;

    const value = clauseValue(child.value);
    if (!value) return undefined;
    values.push(value);
  }

  const key = field ? FIELD_FILTERS[field] : undefined;
  return key ? `${key}:${values.join('|')}` : undefined;
}

/**
 * A required clause as one OpenAlex filter, or nothing when it has no form.
 *
 * A topic wildcard goes to `title_and_abstract.search.exact`, where the flat
 * path below already sends one — the exact key is measured for that field and
 * no other — under the same `exactRunnable` rules. Measured with an author
 * filter beside it on 2026-10-01: `title_and_abstract.search.exact:generat*,
 * raw_author_name.search:Doudna` answered 81 open works.
 */
function clauseFilter(node: Extract<QueryNode, { kind: 'clause' }>): string | undefined {
  const key = FIELD_FILTERS[node.field];
  if (!key) return undefined;

  if (node.field === 'topic' && node.value.kind === 'term' && /[*?]/.test(node.value.text)) {
    const term = node.value.text.trim();
    return exactRunnable(term) ? `title_and_abstract.search.exact:${term}` : undefined;
  }

  // Only here, on a required clause: inside an `OR` the words would sit beside
  // a `|`, and how OpenAlex groups the two has not been measured.
  const value =
    (node.field === 'author' && node.value.kind === 'phrase' && authorPhraseValue(node.value.text)) ||
    clauseValue(node.value);
  return value ? `${key}:${value}` : undefined;
}

/**
 * The query as OpenAlex filters, or `undefined` when it cannot be sent without
 * widening it for good.
 *
 * Repeating a key is how two requirements on one field are stated, and OpenAlex
 * ANDs them like any other pair of filters — measured, `title.search:crispr,
 * title.search:cas9` answered 20,350 against 49,423 for `crispr` alone.
 *
 * A required clause or `OR` with no filter form is left out of the request when
 * `matchesQuery` applies it afterwards — a title, abstract or author clause, a
 * venue or a publisher, which have no key at all. One that holds a topic or
 * `ALL=` term it does not apply: everything the wider request brings back is
 * kept (see `dropsForGood`), so OpenAlex is not asked. That was the failure for
 * `AU=Doudna AND TS=*generation`, sent as the author alone and answered with
 * every Doudna paper.
 *
 * `NOT` is left out even though `raw_author_name.search:!Doudna` is accepted
 * and does reduce the count. Excluding slightly more than the query asked is
 * the one direction that cannot be undone downstream, and exactly what `!`
 * matches on a stemmed search field has not been measured here. The clause is
 * dropped and `matchesQuery` applies it instead, convicting a record for having
 * what it excludes.
 */
function fieldFilters(expression: QueryNode): string[] | undefined {
  const filters: string[] = [];

  for (const node of conjuncts(expression)) {
    if (node.kind === 'not') continue;

    const filter = node.kind === 'clause' ? clauseFilter(node) : node.kind === 'or' ? orFilter(node) : undefined;
    if (filter) filters.push(filter);
    else if (dropsForGood(node)) return undefined;
  }

  return filters;
}

export type TranslateOptions = {
  /** Adds `is_oa:true`, which OpenAlex applies upstream. */
  openAccessOnly?: boolean;
};

export function toParams(query: Query, options: TranslateOptions = {}): OpenAlexParams {
  const filters: string[] = [];

  if (options.openAccessOnly) filters.push('is_oa:true');

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    filters.push(`publication_year:${from ?? EARLIEST}-${to ?? LATEST}`);
  }

  if (query.stages?.length && !query.doi) {
    const types = typeFilters(query.stages);
    // Nothing this provider holds is what was asked for. `plan` skips a
    // provider on the same condition, so this is the backstop.
    if (!types) return {};
    filters.push(...types);
  }

  if (query.doi) {
    // A DOI is a filter, not a search term. Sent as free text the old path
    // found 267 loosely-matching records instead of the one paper.
    filters.push(`doi:${query.doi.toLowerCase()}`);
    return filters.length > 0 ? { filter: filters.join(',') } : {};
  }

  /**
   * A query that names a field is built from the parse, not from the flat
   * words — because the flat form has nowhere to put a field, and sending
   * `AU=Doudna` through it asked for the *word* "Doudna" in titles and
   * abstracts. That is a different question, and a narrower one: a paper
   * Doudna wrote whose title does not say so was never fetched, and nothing
   * downstream can recover a record no provider returned. OpenAlex was
   * declared unable to scope a field at all for that reason, which cost every
   * fielded search the largest source in the fan-out.
   *
   * Built from the parse too when the flat words cannot state the query, which
   * is anything nested: `crispr AND (mouse OR rat)` flattens to `crispr`, and
   * asked for that, OpenAlex returned 49 papers of 553 mentioning either
   * animal, every one kept since the `OR` it lost is a topic clause (see
   * `flatStatesWhole`). The `OR` is a filter of its own here — and measured on
   * 2026-10-01, `title_and_abstract.search:crispr,title_and_abstract.search:
   * mouse|rat` answered 9,657 open works, the union exactly (8,990 with mouse,
   * 872 with rat, 205 with both).
   *
   * Left to the flat path below otherwise, which is the common case and the
   * one every measurement in this file was taken against.
   */
  if (query.expression && (usesScopedField(query.expression) || !flatStatesWhole(query.expression))) {
    const scoped = fieldFilters(query.expression);
    // Nothing of it OpenAlex can state — `SO=Nature` on its own — or nothing it
    // can state without widening it for good. Returning no params makes
    // `translate` empty, and `fanOut` reports the provider skipped instead of
    // letting `is_oa:true` read the open-access corpus.
    if (!scoped || scoped.length === 0) return {};

    filters.push(...scoped);
    return { filter: filters.join(',') };
  }

  const words = query.terms.map(t => t.trim()).filter(Boolean);
  const wildcards = words.filter(word => /[*?]/.test(word));
  const exact = wildcards.filter(exactRunnable);

  /**
   * A wildcard OpenAlex cannot run is not left out: OpenAlex is not asked.
   *
   * Left out, it would widen the search, and the widening is undone only where
   * `matchesQuery` convicts a record that lacks the term — which it never does
   * for a `topic` term, and the flat form no longer says which field a term
   * came from. Measured on 2026-09-30 for `TS=crispr AND TS=*generation`: asked
   * for `crispr` alone, OpenAlex returned 14% papers containing a
   * `*generation` word. See `flatTerms`.
   */
  if (exact.length < wildcards.length) return {};

  /**
   * Nor is an OR with a wildcard in it.
   *
   * The wildcards go to a second filter, and OpenAlex ANDs its filters, so
   * `a OR gen*` could only be sent as `a AND gen*`, which reads less than the
   * query means: the records only the other side matched would never be read.
   */
  if (query.join === 'OR' && wildcards.length > 0) return {};

  /**
   * The words and phrases, joined as the query joins them.
   *
   * They were always joined with a space, which OpenAlex reads as AND — so
   * `TS=cancer OR TS=zebrafish` asked the largest provider for papers with
   * both, and every OR search read from it only the overlap of its sides. The
   * local evaluator cannot put back what was never read. `OR` inside the value
   * is honoured, measured against the live API on 2026-09-29, open works:
   *
   *   cancer 2,774,546   zebrafish 65,249   cancer zebrafish 4,548
   *   cancer OR zebrafish 2,835,247 — the union exactly, 2,774,546 + 65,249 − 4,548
   *   zebrafish OR "gene editing" 89,321 — again the union, phrase and all
   *
   * Upper case only: `zebrafish or "gene editing"` answered 386, the overlap,
   * with `or` read as a word. OpenAlex honours quoted phrases either way, and
   * returns its `relevance_score` for an OR as for anything else.
   */
  const search = filterSafe(
    [...words.filter(word => !/[*?]/.test(word)), ...query.phrases.map(quote)]
      .filter(Boolean)
      .join(query.join === 'OR' ? ' OR ' : ' ')
  );

  /**
   * Nothing to search for means no request, and it has to be decided here.
   *
   * The caller's emptiness check reads the returned params, and `is_oa:true`
   * alone is a perfectly valid filter — for the entire open-access corpus. A
   * query with no words would have fanned out and started reading it.
   */
  if (!search && exact.length === 0) return {};

  /**
   * `title_and_abstract.search`, not the `search` parameter.
   *
   * The `search` parameter searches the full text as well, and the difference
   * is not marginal: measured on `ai`, `search=ai` with `is_oa:true` reports
   * **4,636,103** matches and `title_and_abstract.search:ai` reports
   * **940,199**. The first number was the one the header showed as its floor,
   * because it is the largest — so the figure a reader saw for "how much is
   * out there" was set by whichever provider asked the vaguest question, and
   * OpenAlex asks the vaguest one in the fan-out by a factor of five.
   *
   * It is also a precision change and not only a reporting one. A paper that
   * merely mentions the words somewhere in its body is not what a search for
   * them is asking for, and it was competing for the 600 records we read.
   *
   * Relevance ordering survives the move: verified against the live API, the
   * filter form returns `relevance_score` and orders by it, which is what the
   * rank fusion in `orchestrator/rank.ts` reads.
   */
  if (search) filters.push(`title_and_abstract.search:${search}`);
  // A second filter, ANDed with the first as every OpenAlex filter is:
  // `title_and_abstract.search:cancer,title_and_abstract.search.exact:gen*`
  // answered 950,916 open works against 19,268,710 for `gen*` alone. Words in
  // one value are ANDed too: `crispr gen*` answered 78,486.
  if (exact.length > 0) filters.push(`title_and_abstract.search.exact:${exact.join(' ')}`);

  return { filter: filters.join(',') };
}

export function translate(query: Query, options: TranslateOptions = {}): string {
  const params = toParams(query, options);
  // Sorted with a plain comparison rather than `localeCompare`, whose ordering
  // depends on the runtime's locale — a key that sorts differently on two
  // machines is not a key.
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
