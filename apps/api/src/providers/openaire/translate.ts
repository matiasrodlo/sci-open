import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> OpenAIRE's request parameters.
 *
 * OpenAIRE has no query language: a search is a set of parameters, and the
 * date bounds are two of them rather than clauses in a string. So `translate`
 * returns a canonical serialisation of those parameters rather than a query —
 * which is exactly what the caller needs it for. The orchestrator uses the
 * returned string as part of the provider cache key, and a key that left the
 * year bounds out would serve a 2022–2023 search from an unbounded one.
 */

export type OpenAireParams = {
  /** Free text. Absent for a DOI lookup, which uses `doi` instead. */
  keywords?: string;
  /**
   * OpenAIRE's own DOI parameter.
   *
   * Not `keywords`. A DOI sent as free text makes the query parser fail —
   * `HTTP 409`, `"Syntax errors. expected boolean, got '/'"` — because the
   * slash is an operator to it. The old connector assigned the DOI to
   * `keywords`, so every OpenAIRE DOI lookup has been answering 409.
   */
  doi?: string;
  format: 'json';
  OA?: 'true';
  fromDateAccepted?: string;
  toDateAccepted?: string;
};

export type TranslateOptions = {
  /** OpenAIRE takes this as a request parameter, `OA=true`. */
  openAccessOnly?: boolean;
};

/**
 * The parameters themselves. `translate` is the string form of this.
 */
export function toParams(query: Query, options: TranslateOptions = {}): OpenAireParams {
  const { from, to } = query.years ?? {};

  const bounds = {
    format: 'json' as const,
    ...(options.openAccessOnly ? { OA: 'true' as const } : {}),
    ...(from !== undefined ? { fromDateAccepted: `${from}-01-01` } : {}),
    ...(to !== undefined ? { toDateAccepted: `${to}-12-31` } : {})
  };

  if (query.doi) return { doi: query.doi, ...bounds };

  // No query language means phrases cannot be marked as adjacent and terms
  // cannot be marked as required; OpenAIRE decides. Joining them with spaces
  // is the whole of what can be expressed.
  const keywords = [...query.terms, ...query.phrases].map(t => t.trim()).filter(Boolean).join(' ');

  return { keywords, ...bounds };
}

export function translate(query: Query, options: TranslateOptions = {}): string {
  const params = toParams(query, options);
  // Sorted so the same search always serialises identically, which is what
  // makes this usable as a cache key. The comparison is a plain one rather
  // than `localeCompare`, whose ordering depends on the runtime's locale — a
  // key that sorts differently on two machines is not a key.
  return Object.entries(params)
    .filter(([key]) => key !== 'format')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
