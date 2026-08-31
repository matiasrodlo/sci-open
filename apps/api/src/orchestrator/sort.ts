import type { Paper, SearchSort } from '@open-access-explorer/shared';

/**
 * The caller's chosen ordering, applied after ranking and filtering.
 *
 * `relevance` is not a sort — it is the order `rank` already produced, so it
 * passes through untouched. Every other mode replaces that order with an
 * explicit one, which is what the user asked for.
 *
 * Sorting runs after the policy filter so it only ever orders records that
 * will be returned, and before pagination so a page is a slice of the sorted
 * set rather than a sorted slice.
 */

/**
 * Missing values sort last, in both directions.
 *
 * The numeric comparators already did this — `-Infinity` descending,
 * `+Infinity` ascending — so an undated paper is last either way. The text
 * comparator did not: it mapped a missing value to `''`, which collates before
 * every non-empty string, so ascending text sorts opened with every paper that
 * had nothing to sort by. Measured on "crispr": 14% of results carry no venue
 * and about 1% no author, and "Author (A-Z)" returned a first page that was 16
 * rows of 20 blank in the one column the reader had just asked to order by.
 * "Author (Z-A)" was clean, because there the empty strings fell off the end.
 *
 * A row with nothing to show is not the best match for "sort by this", in
 * either direction.
 */
const byNumberDesc = (a?: number, b?: number) => (b ?? -Infinity) - (a ?? -Infinity);
const byNumberAsc = (a?: number, b?: number) => (a ?? Infinity) - (b ?? Infinity);

const byText = (a: string | undefined, b: string | undefined, dir: 1 | -1 = 1) => {
  const left = a ?? '';
  const right = b ?? '';
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return dir * left.localeCompare(right);
};

const COMPARATORS: Record<Exclude<SearchSort, 'relevance'>, (a: Paper, b: Paper) => number> = {
  date: (a, b) => byNumberDesc(a.year, b.year),
  date_asc: (a, b) => byNumberAsc(a.year, b.year),
  citations: (a, b) => byNumberDesc(a.citationCount, b.citationCount),
  citations_asc: (a, b) => byNumberAsc(a.citationCount, b.citationCount),
  // Reversed with `dir` rather than by swapping the arguments: swapping would
  // reverse the missing-last rule along with the ordering, which is the bug
  // this comparator exists to avoid.
  author: (a, b) => byText(a.authors[0], b.authors[0]),
  author_desc: (a, b) => byText(a.authors[0], b.authors[0], -1),
  venue: (a, b) => byText(a.venue, b.venue),
  venue_desc: (a, b) => byText(a.venue, b.venue, -1),
  title: (a, b) => byText(a.title, b.title),
  title_desc: (a, b) => byText(a.title, b.title, -1)
};

export function sortPapers(papers: readonly Paper[], sort: SearchSort = 'relevance'): Paper[] {
  if (sort === 'relevance') return [...papers];

  const compare = COMPARATORS[sort];
  if (!compare) return [...papers];

  // Ties keep the ranked order, so a sort that cannot separate two papers
  // still returns the more relevant one first rather than an arbitrary one.
  return papers
    .map((paper, index) => ({ paper, index }))
    .sort((a, b) => compare(a.paper, b.paper) || a.index - b.index)
    .map(entry => entry.paper);
}
