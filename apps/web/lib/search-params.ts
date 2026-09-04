import type { SearchSort } from '@open-access-explorer/shared';

/**
 * How a multi-valued filter travels in the URL.
 *
 * It is a repeated parameter — `?venue=A&venue=B` — and not a comma-joined
 * one. Comma-joining silently loses any value that contains a comma, and
 * facet values contain commas constantly: measured, 25 values in a single
 * result set, including ordinary journal names like
 * `Bioinformatics (Oxford, England)`. Clicking one wrote it into the URL as
 * two fragments, neither of which matched anything, so the filter appeared to
 * work and returned nothing.
 *
 * Repeated parameters have no such character. `URLSearchParams` encodes and
 * decodes them, and both `URLSearchParams.getAll` and Next's `searchParams`
 * hand them back as an array.
 *
 * A comma is deliberately *not* treated as a separator any more, so an old
 * bookmarked URL carrying `venue=A,B` now reads as the single value `A,B`.
 * That filter matches nothing rather than matching the wrong two things, which
 * is the failure mode worth having.
 */

/** Next's `searchParams` value -> the list of values actually supplied. */
export function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const values = (Array.isArray(value) ? value : [value]).filter(v => v && v.length > 0);
  return values.length > 0 ? values : undefined;
}

/** The first value, for parameters that only ever carry one. */
export function toSingle(value: string | string[] | undefined): string | undefined {
  return toList(value)?.[0];
}

/**
 * Replaces one filter's values, and sends the reader back to page one.
 *
 * Resetting the page is not a nicety. Narrowing a 4,000-result search while
 * standing on page 40 asks for a page that the narrowed set does not have, and
 * the reader gets an empty screen from a filter that matched plenty.
 */
export function withFilter(
  current: URLSearchParams,
  key: string,
  values: readonly string[]
): URLSearchParams {
  const params = new URLSearchParams(current);
  params.delete(key);
  for (const value of values) params.append(key, value);
  params.delete('page');
  return params;
}

/**
 * The page bound the API enforces, stated once on this side too.
 *
 * Keep in step with `MAX_PAGE` in `apps/api/src/lib/schemas.ts`. Duplicated
 * rather than imported because that file is a server-side schema in another
 * workspace package; the number is small, stable, and named on both sides so
 * the pair is findable.
 */
export const MAX_PAGE = 1000;

/**
 * The page a URL is asking for, clamped to one that can exist.
 *
 * `parseInt(page ?? '') || 1` already mapped a missing or non-numeric value to
 * 1, and it let a negative one through, because `-5` is truthy. The API's
 * schema requires `1 <= page <= MAX_PAGE` and answers 400 outside it, which
 * arrives in the UI as "There was an error performing your search" — telling
 * the reader the service is broken when the truth is that their URL asked for
 * a page that does not exist. A stale bookmark or a hand-edited address should
 * land on the nearest real page instead.
 */
export function toPage(value: string | string[] | undefined): number {
  const parsed = parseInt(toSingle(value) ?? '', 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), MAX_PAGE);
}

/**
 * The year bounds the API enforces, stated once on this side too.
 *
 * Keep in step with the `yearFrom`/`yearTo` range in
 * `apps/api/src/lib/schemas.ts`, for the reason `MAX_PAGE` is duplicated.
 */
export const MIN_YEAR = 1000;
export const MAX_YEAR = 9999;

/**
 * A year bound the API will accept, or none at all.
 *
 * The same defect `toPage` was written for, in the two parameters beside it.
 * The results page read these as `yearFrom ? parseInt(yearFrom) : undefined`,
 * so `?yearFrom=abc` became `NaN`, which `JSON.stringify` writes as `null`, and
 * the schema answered 400 — surfacing as "There was an error performing your
 * search". `?yearFrom=999` did the same by being one below the schema's
 * minimum. In both cases the service is fine and the URL is asking for
 * something that cannot exist.
 *
 * Unparseable means no bound: there is no year to filter on, and the honest
 * answer is the unfiltered set. Out of range is clamped rather than dropped,
 * which is `toPage`'s rule and matters in the upper direction — dropping
 * `yearTo=99999` would silently widen the search to everything, where clamping
 * preserves what the reader plainly meant.
 */
export function toYear(value: string | string[] | undefined): number | undefined {
  const parsed = parseInt(toSingle(value) ?? '', 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, MIN_YEAR), MAX_YEAR);
}

/**
 * Every sort the API's schema accepts, as an exhaustive map.
 *
 * A `readonly SearchSort[]` would not catch drift: a subset is assignable to
 * it, so a sort added to the shared union would simply be missing here and
 * would 400 at runtime. `satisfies Record<SearchSort, true>` fails the build
 * until the new one is listed, which is the property worth having in a table
 * that exists to mirror somebody else's enum.
 */
const SORTS = {
  relevance: true,
  date: true,
  date_asc: true,
  citations: true,
  citations_asc: true,
  author: true,
  author_desc: true,
  venue: true,
  venue_desc: true,
  title: true,
  title_desc: true
} satisfies Record<SearchSort, true>;

/**
 * The sort a URL is asking for, or relevance.
 *
 * `sort` reached the API as `(sort as any) || 'relevance'` — the cast is the
 * whole bug, because it made an unchecked query parameter look like a
 * `SearchSort` to everything downstream. The schema rejects anything outside
 * the enum, so `?sort=year` from a stale bookmark, a hand-edited address or an
 * older build of this page answered 400 and the reader was told the search had
 * failed.
 *
 * Relevance is the fallback because it is already what a *missing* `sort`
 * means, so an unreadable one lands on the same page an absent one would
 * rather than on an error.
 */
export function toSort(value: string | string[] | undefined): SearchSort {
  const candidate = toSingle(value);
  return candidate && Object.prototype.hasOwnProperty.call(SORTS, candidate)
    ? (candidate as SearchSort)
    : 'relevance';
}
