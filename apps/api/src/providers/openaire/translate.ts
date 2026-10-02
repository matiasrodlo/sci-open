import type { Query, QueryField, QueryNode } from '@open-access-explorer/shared';
import { cannotSend, flatStatesWhole, flatTerms, renderExpression, type Dialect } from '../render-query';

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
 * A term as the search takes it, or `''` for a wildcard, which it does not have.
 * Measured on 2026-09-30, `generation` 6,825,154 and `generat*` 3,793, `genome`
 * 1,339,519 and `genom*` 167,992, and `*generation` exactly what `generation`
 * finds — the `*` ignored.
 */
function sendable(term: string): string {
  return /[*?]/.test(term) ? '' : term.trim();
}

/**
 * A phrase as the bare words it has always been sent as (see `toParams`),
 * grouped when there are several so an `OR` beside it cannot split them.
 * Measured on 2026-10-01, `zebrafish OR (gene editing)` answered 141,933, the
 * union exactly (92,431 + 50,387 − 885). Parentheses and quotes are dropped
 * from the words, since an unbalanced one is an HTTP 400.
 */
function words(phrase: string): string {
  const text = phrase.replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();
  return /\s/.test(text) ? `(${text})` : text;
}

/** What the search reads: the body text, which is every field it has. */
const BODY_TEXT: ReadonlySet<QueryField> = new Set<QueryField>(['topic', 'title', 'abstract', 'all']);

/**
 * The search's own syntax, for a query the flat form cannot state whole.
 *
 * One index and no fields, so a body-text clause is the search itself, and it
 * honours `AND`, `OR` and parentheses: measured on 2026-10-01,
 * `(crispr AND (mouse OR rat))` answered 12,012, the union exactly (11,205 with
 * mouse, 1,032 with rat, 225 with both). `OR` must be upper case:
 * `cancer or zebrafish` answered 3,070, neither the union nor the overlap.
 *
 * An author, a venue or a publisher has no field here, and searching the name
 * as words would ask for the papers that mention it — a narrower question — so
 * `unscoped` leaves those clauses out and `matchesQuery` applies them. No
 * `NOT`, which has not been measured here: left out, it only widens. `ALL=` is
 * read as body text, as the flat form reads it, though it also covers authors
 * and venues.
 */
const DIALECT: Dialect = {
  fields: field => (BODY_TEXT.has(field) ? ['search'] : []),
  scope: (_native, value) => value,
  term: sendable,
  phrase: words,
  years: () => undefined,
  doi: () => undefined,
  unscoped: () => undefined,
  supportsNot: false
};

/**
 * The flat form, as the search has always been sent it — with alternatives
 * joined as alternatives.
 *
 * They were joined with a space whatever the query's join, and a space is AND
 * here as it is to OpenAlex, so every OR search read only the overlap of its
 * sides from OpenAIRE. Measured on 2026-09-30: `cancer` 4,893,595, `zebrafish`
 * 92,429, `cancer zebrafish` 7,159, and `cancer OR zebrafish` 4,978,865 — the
 * union exactly.
 */
function flatSearch(query: Query): string {
  // A wildcard is not left out, since the flat form does not say whether it
  // was a topic term. See `flatTerms`.
  const terms = flatTerms(query, sendable);
  if (!terms) return '';
  const phrases = query.phrases.map(phrase => phrase.trim()).filter(Boolean);
  if (query.join === 'OR') return [...terms, ...phrases.map(words)].join(' OR ');
  return [...terms, ...phrases].join(' ');
}

/** A nested query in the search's syntax, or nothing it can be sent as. See `cannotSend`. */
function nestedSearch(expression: QueryNode): string {
  if (cannotSend(expression, DIALECT)) return '';
  return renderExpression(expression, DIALECT) ?? '';
}

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
  //
  // From the flat form when it states the query whole, which keeps the common
  // search exactly as it was. Anything nested loses its inner structure there —
  // `crispr AND (mouse OR rat)` reached OpenAIRE as `crispr`, and 11 of the 465
  // papers it returned mentioned either animal — so it is rendered instead.
  // See `flatStatesWhole`.
  const search =
    query.expression && !flatStatesWhole(query.expression) ? nestedSearch(query.expression) : flatSearch(query);

  // Published, and not the unknowns beside it, is the one narrowing OpenAIRE
  // can be asked for. A search for preprints never gets here: `normalize`
  // never produces one, so `plan` skips this provider for it.
  const stages = query.stages;
  const peerReviewed = !!stages?.length && stages.includes('published') && !stages.includes('unknown');

  return { search, ...bounds, ...(peerReviewed ? { isPeerReviewed: 'true' as const } : {}) };
}

export function translate(query: Query, options: TranslateOptions = {}): string {
  const params = toParams(query, options);
  // Nothing to search for is nothing to send, which the fan-out reports as a
  // skip — rather than the access and date filters alone, which read as a
  // query and are answered with nothing.
  if (!params.search && !params.pid) return '';
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
