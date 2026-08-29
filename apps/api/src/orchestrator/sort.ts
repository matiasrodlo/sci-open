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

const byNumberDesc = (a?: number, b?: number) => (b ?? -Infinity) - (a ?? -Infinity);
const byNumberAsc = (a?: number, b?: number) => (a ?? Infinity) - (b ?? Infinity);
const byText = (a: string | undefined, b: string | undefined) =>
  (a ?? '').localeCompare(b ?? '');

const COMPARATORS: Record<Exclude<SearchSort, 'relevance'>, (a: Paper, b: Paper) => number> = {
  date: (a, b) => byNumberDesc(a.year, b.year),
  date_asc: (a, b) => byNumberAsc(a.year, b.year),
  citations: (a, b) => byNumberDesc(a.citationCount, b.citationCount),
  citations_asc: (a, b) => byNumberAsc(a.citationCount, b.citationCount),
  author: (a, b) => byText(a.authors[0], b.authors[0]),
  author_desc: (a, b) => byText(b.authors[0], a.authors[0]),
  venue: (a, b) => byText(a.venue, b.venue),
  venue_desc: (a, b) => byText(b.venue, a.venue),
  title: (a, b) => byText(a.title, b.title),
  title_desc: (a, b) => byText(b.title, a.title)
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
