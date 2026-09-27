import type { Paper } from '@open-access-explorer/shared';

/**
 * The record a results click carries into the paper page, for the first paint.
 *
 * This is a placeholder store rather than a cache, and the distinction is the
 * whole point of it. It used to be read cache-first: a hit was displayed and
 * the effect returned, so a record stashed here was shown for the rest of the
 * session and `/api/paper/:id` was never asked. That is how one URL came to
 * serve two different bodies — the merged, enriched record to a visitor who
 * clicked through, and whatever the endpoint said to a visitor who followed a
 * link, reloaded, or opened a new tab.
 *
 * The page now paints whatever is here and asks the endpoint regardless,
 * replacing this with the answer. So an entry can only shorten the wait before
 * the first paint; it cannot decide what is finally shown. That is also why
 * there is no TTL and no eviction policy to get wrong — nothing here is served
 * for longer than one request takes, and a stale entry is corrected on the same
 * view that displayed it.
 *
 * Writes are best effort. `sessionStorage` throws when it is full and when the
 * browser is set to refuse it, and a placeholder that could not be stored costs
 * a loading skeleton and nothing else — so a failure here is not an error and
 * is not reported as one.
 *
 * The prefix names the shape. A tab open across a deploy still holds entries
 * written as `OARecord`s under the old prefix, and painted as a `Paper` one
 * would have no `sources` to read; under a new prefix it is simply not found.
 */

const CACHE_KEY_PREFIX = 'paper_v2_';

export function cachePaper(paper: Paper): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(`${CACHE_KEY_PREFIX}${paper.id}`, JSON.stringify(paper));
  } catch {
    // Full, or refused. The page fetches either way.
  }
}

export function getCachedPaper(id: string): Paper | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = sessionStorage.getItem(`${CACHE_KEY_PREFIX}${id}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    // Unreadable or malformed. Absent and present-but-broken mean the same
    // thing to the caller: paint nothing yet and wait for the request.
    return null;
  }
}
