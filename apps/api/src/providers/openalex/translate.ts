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
  /** Free text. Absent for a DOI lookup, which filters instead. */
  search?: string;
  /** Comma-separated, OpenAlex's own syntax. */
  filter?: string;
};

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

  // OpenAlex's `search` honours quoted phrases; bare terms are already
  // required, so there is nothing to spell out for them.
  const search = [...query.terms.map(t => t.trim()), ...query.phrases.map(p => `"${p.trim()}"`)]
    .filter(t => t && t !== '""')
    .join(' ');

  return {
    ...(search ? { search } : {}),
    ...(filters.length > 0 ? { filter: filters.join(',') } : {})
  };
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
