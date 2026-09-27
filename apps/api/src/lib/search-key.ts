import type { SearchParams, SearchResponse } from '@open-access-explorer/shared';

/**
 * The identity of a search request — query, page, sort and filters — which
 * the route collapses concurrent duplicates onto with `SingleFlight`.
 *
 * It was the key of a response cache as well, until that cache went: it held
 * each page for up to an hour, so a page computed from one result set could
 * outlive it and sit beside pages from the next. Result sets are held in
 * `orchestrator/result-set.ts` now, and a page is presented from one on every
 * request.
 *
 * **Derived from `SearchParams` and nothing else.** It once took the query text
 * as a separate argument, and the route passed `params.q || ''` — so
 * `params.doi`, which `runOrchestrator` gives precedence over `q`, never
 * reached it, and every `{ doi }` request collided on one entry. A subject
 * passed in beside the params that decide it can disagree with them.
 */
export function searchKey(params: SearchParams): string {
  return JSON.stringify({
    subject: normalizeQuery(params.doi ?? params.q ?? ''),
    page: params.page || 1,
    pageSize: params.pageSize || 20,
    sort: params.sort || 'relevance',
    filters: normalizeFilters(params.filters)
  });
}

/**
 * Case and whitespace only.
 *
 * It used to also strip every character outside `[\w\s]`, and JavaScript's
 * `\w` is ASCII-only — so `TNF-α` and `TNF` both normalised to `tnf`, as did
 * `alpha/beta` and `alphabeta`. Dropping characters to normalise a key is what
 * makes two questions look like one.
 */
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * The same filters in any order are the same search: filter names sorted, and
 * each list of values sorted, since the values are joined by OR.
 */
function normalizeFilters(filters: SearchParams['filters']): Array<[string, unknown]> {
  return Object.entries(filters ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([name, value]): [string, unknown] => [name, Array.isArray(value) ? [...value].sort() : value])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Whether an answer is whole, and so worth a cache's keeping.
 *
 * `complete: false` means a provider failed or timed out, so `total` is a lower
 * bound and whole sources are missing from the hits and the facets. Kept, one
 * provider's bad minute would be served to everyone asking that question — and
 * nothing could get past it, because the frontend's retry re-posts the
 * identical request. `ResultSetCache` keeps only complete sets for this
 * reason; the route states the same rule in `Cache-Control`.
 *
 * `bounded` is deliberately not consulted, though it makes `total` a lower
 * bound just as `complete: false` does. It is set two ways, and neither is a
 * reason to resolve the set again. A rescue that hit its limit is
 * deterministic — ask again and the same limit cuts the same list at the same
 * place. One that ran out of its wall-clock budget is not, since how far it got
 * depends on how fast Unpaywall answered — but on a broad query the budget
 * expires every time, so declining to keep those would repeat a ten-provider
 * fan-out on every page of every broad search. What it reached is held with
 * the set, and the authorities' answers outlive it in `AuthorityFactsCache`,
 * so the next resolution of the same search starts further along.
 */
export function worthCaching(result: SearchResponse): boolean {
  return result.complete !== false;
}
