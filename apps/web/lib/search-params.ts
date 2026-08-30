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
