import axios from 'axios';
import { OARecord, SearchParams, SearchResponse } from '@open-access-explorer/shared';

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
 * The chain has to be *started* by a real proxy in front of this app, exactly
 * as the route handler's own comment says — a server component cannot see its
 * own socket any more than a route handler can. So this passes on what it was
 * given and invents nothing; the API, in turn, believes it only for the hops
 * named in its `TRUST_PROXY`.
 */
export type Caller = {
  /** The incoming request's `x-forwarded-for`, when there is one. */
  forwardedFor?: string | undefined;
};

function callerHeaders(caller: Caller): Record<string, string> {
  return caller.forwardedFor ? { 'x-forwarded-for': caller.forwardedFor } : {};
}

export async function searchPapers(params: SearchParams, caller: Caller = {}): Promise<SearchResponse> {
  const response = await axios.post<SearchResponse>(apiUrl('/api/search'), params, {
    headers: callerHeaders(caller)
  });
  return response.data;
}

/**
 * `/api/paper/:id` returns the record itself.
 *
 * It was typed `PaperResponse` — `{ record, pdf: { url?, status } }` — which
 * the endpoint has never returned. Nothing read the declared shape, because
 * the only caller bypassed this function and treated the response as what it
 * actually is. The type is gone rather than corrected: `OARecord` is the
 * contract, and a second name for it that disagreed was the whole problem.
 */
export async function getPaper(id: string): Promise<OARecord> {
  const response = await axios.get<OARecord>(apiUrl(`/api/paper/${encodeURIComponent(id)}`), {
    headers: { 'Cache-Control': 'no-store' }
  });
  return response.data;
}
