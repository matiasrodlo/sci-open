import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> OpenAIRE's request parameters.
 *
 * OpenAIRE's search is a set of parameters, and the date bounds are two of them
 * rather than clauses in a string. So `translate` returns a canonical
 * serialisation of those parameters rather than a query — which is exactly
 * what the caller needs it for. The orchestrator uses the returned string as
 * part of the provider cache key, and a key that left the year bounds out would
 * serve a 2022–2023 search from an unbounded one.
 *
 * These are the Graph API's names (`/graph/v1/researchProducts`), not the
 * legacy search endpoint's: `search` for `keywords`, `pid` for `doi`,
 * `bestOpenAccessRightLabel` for `OA`, `*PublicationDate` for `*DateAccepted`.
 * See `fetch.ts` for why the endpoint changed.
 */

export type OpenAireParams = {
  /**
   * Free text. Absent for a DOI lookup, which uses `pid` instead.
   *
   * Words separated by spaces are all required — `crispr cas9` and
   * `crispr AND cas9` both matched 66,318 on 2026-09-25 — which is the same
   * reading the legacy `keywords` parameter gave. The parameter does have a
   * syntax of its own, and an unbalanced `(` or `"` answers HTTP 400, but the
   * legacy one refused those too (HTTP 409), and it refused a bare slash as
   * well, which this one accepts.
   */
  search?: string;
  /**
   * A persistent identifier, matched exactly — here always a DOI.
   *
   * Not `search`, which would treat it as words and match every record that
   * mentions the prefix.
   */
  pid?: string;
  /**
   * `researchProducts` also holds datasets, software and "other" results. The
   * legacy `/publications` endpoint held only these, so leaving this out would
   * widen what the provider returns rather than just where it asks.
   */
  type: 'publication';
  bestOpenAccessRightLabel?: 'OPEN';
  fromPublicationDate?: string;
  toPublicationDate?: string;
  /**
   * Refereed instances only. `normalize` calls a record published exactly when
   * its instance says `peerReviewed`, so this is the same test asked upstream.
   * Measured on `ai` with the open filter, 2026-09-25: 437,691 of 694,882.
   */
  isPeerReviewed?: 'true';
};

export type TranslateOptions = {
  /** OpenAIRE takes this as a request parameter, `bestOpenAccessRightLabel=OPEN`. */
  openAccessOnly?: boolean;
};

/**
 * The parameters themselves. `translate` is the string form of this.
 */
export function toParams(query: Query, options: TranslateOptions = {}): OpenAireParams {
  const { from, to } = query.years ?? {};

  const bounds = {
    type: 'publication' as const,
    ...(options.openAccessOnly ? { bestOpenAccessRightLabel: 'OPEN' as const } : {}),
    ...(from !== undefined ? { fromPublicationDate: `${from}-01-01` } : {}),
    ...(to !== undefined ? { toPublicationDate: `${to}-12-31` } : {})
  };

  if (query.doi) return { pid: query.doi, ...bounds };

  // Terms and phrases are sent as bare words, as they were to the legacy
  // endpoint. Quoting a phrase would be expressible here, but it would narrow
  // what this provider returns relative to what it returned before, and that
  // is a separate decision from which endpoint to ask.
  const search = [...query.terms, ...query.phrases].map(t => t.trim()).filter(Boolean).join(' ');

  // Published, and not the unknowns beside it, is the one narrowing OpenAIRE
  // can be asked for. A search for preprints never gets here: `normalize`
  // never produces one, so `plan` skips this provider for it.
  const stages = query.stages;
  const peerReviewed = !!stages?.length && stages.includes('published') && !stages.includes('unknown');

  return { search, ...bounds, ...(peerReviewed ? { isPeerReviewed: 'true' as const } : {}) };
}

export function translate(query: Query, options: TranslateOptions = {}): string {
  const params = toParams(query, options);
  // Sorted so the same search always serialises identically, which is what
  // makes this usable as a cache key. The comparison is a plain one rather
  // than `localeCompare`, whose ordering depends on the runtime's locale — a
  // key that sorts differently on two machines is not a key. `type` is left
  // out because it never varies.
  return Object.entries(params)
    .filter(([key]) => key !== 'type')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
