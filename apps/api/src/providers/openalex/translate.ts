import type { Query } from '@open-access-explorer/shared';

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

  if (query.doi) {
    // A DOI is a filter, not a search term. Sent as free text the old path
    // found 267 loosely-matching records instead of the one paper.
    filters.push(`doi:${query.doi.toLowerCase()}`);
    return filters.length > 0 ? { filter: filters.join(',') } : {};
  }

  // OpenAlex's search honours quoted phrases; bare terms are already required,
  // so there is nothing to spell out for them.
  const search = filterSafe(
    [...query.terms.map(t => t.trim()), ...query.phrases.map(quote)].filter(Boolean).join(' ')
  );

  /**
   * Nothing to search for means no request, and it has to be decided here.
   *
   * The caller's emptiness check reads the returned params, and `is_oa:true`
   * alone is a perfectly valid filter — for the entire open-access corpus. A
   * query with no words would have fanned out and started reading it.
   */
  if (!search) return {};

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
  filters.push(`title_and_abstract.search:${search}`);

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
