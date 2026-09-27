import axios from 'axios';
import type { Paper, SearchParams, SearchResponseV2 } from '@open-access-explorer/shared';

/**
 * Every call to the API goes through here.
 *
 * The origin is decided in one place, and it is decided differently on the two
 * sides of the render. In the browser the path stays relative, so the route
 * handler at `app/api/[...path]/route.ts` is what points at the API — and it
 * resolves `API_ORIGIN` per request, so the same build runs anywhere. On the
 * server there is no origin to be relative to, so the variable is read here.
 *
 * `API_ORIGIN` deliberately has no `NEXT_PUBLIC_` prefix. That prefix is what
 * makes Next substitute a value into the bundle at compile time, which is
 * exactly the baking this phase removed; without it the variable is read from
 * the process at runtime.
 *
 * That split is why components must not construct URLs themselves: a component
 * cannot know which side it will run on, and the one that hardcoded the
 * localhost origin worked in development and could not have worked anywhere
 * else.
 */

const SERVER_API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:4000';

function apiUrl(path: string): string {
  return typeof window === 'undefined' ? `${SERVER_API_ORIGIN}${path}` : path;
}

/**
 * Who the API is answering, when this call is made on the reader's behalf
 * rather than by the reader's own browser.
 *
 * A browser request reaches the API through `app/api/[...path]/route.ts`, which
 * forwards `x-forwarded-for` for one reason: the API's rate limit keys on
 * `request.ip`, and without the chain it sees this process's address for every
 * visitor. A server-rendered search does not go through that handler — it is
 * issued here, straight to `API_ORIGIN` — so it arrived carrying nothing, and
 * the API keyed *every search in the product* on the web tier.
 *
 * That is not a security nicety, it is the search capacity of the whole site.
 * `/results` is a server component and `Pagination` navigates by URL, so every
 * search is rendered on the server: with `RATE_LIMIT_MAX` at 120 a minute, the
 * site as a whole had 120 searches a minute and one script could spend them.
 *
 * The chain has to be *started* by a proxy in front of this app that appends
 * the visitor's address, exactly as the route handler's own comment says — a
 * server component cannot see its own socket any more than a route handler
 * can, and Next only fills the header when the visitor sent none. So this
 * passes on what it was given and invents nothing; the API believes it only
 * when its `TRUST_PROXY` names this tier.
 */
export type Caller = {
  /** The incoming request's `x-forwarded-for`, when there is one. */
  forwardedFor?: string | undefined;
};

function callerHeaders(caller: Caller): Record<string, string> {
  return caller.forwardedFor ? { 'x-forwarded-for': caller.forwardedFor } : {};
}

/**
 * How long a search may take to answer before the page gives up on it.
 *
 * Above the API's own worst case rather than at it: twenty seconds for the
 * fan-out, five for the rescue and six for enrichment is about thirty-one, so
 * reaching this means the API is hung rather than slow. Without it axios waits
 * forever — the browser path has the route handler's thirty-second budget, but
 * a server-rendered search does not go through that handler, so a stuck API
 * held `/results` open indefinitely. The error it raises is `ECONNABORTED`,
 * which `classifySearchError` already reads as a timeout.
 */
export const SEARCH_TIMEOUT_MS = 45000;

/**
 * A search, in version 2 of the response: each paper as the API holds it —
 * every source that returned it, its access route and stage, and whether its
 * copy was confirmed — and each provider's report whole. Version 1 flattens a
 * paper to one source and a URL, and a report to two counts and an `error`
 * string that a skip had to be spelled into.
 */
export async function searchPapers(params: SearchParams, caller: Caller = {}): Promise<SearchResponseV2> {
  const response = await axios.post<SearchResponseV2>(apiUrl('/api/v2/search'), params, {
    headers: callerHeaders(caller),
    timeout: SEARCH_TIMEOUT_MS
  });
  return response.data;
}

/**
 * `/api/v2/paper/:id` returns the paper itself, in the shape a search returns
 * it, so the detail page and the result card it was opened from read one type.
 */
export async function getPaper(id: string): Promise<Paper> {
  const response = await axios.get<Paper>(apiUrl(`/api/v2/paper/${encodeURIComponent(id)}`), {
    headers: { 'Cache-Control': 'no-store' }
  });
  return response.data;
}
