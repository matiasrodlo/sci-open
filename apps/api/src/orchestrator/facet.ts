import type { Paper } from '@open-access-explorer/shared';

/**
 * Facets over the set that produced the hits.
 *
 * The invariant the whole panel rests on: a bucket's count states exactly how
 * far selecting it narrows the result set. Counting over a different set than
 * the one returned is what made the frontend grow heuristics that "corrected"
 * counts it judged implausible, inventing numbers to replace real ones.
 */

export type FacetBucket = { value: string | number; count: number };
export type Facets = Record<string, FacetBucket[]>;

/** Open-ended facets are capped; bounded ones are sent whole. See phase 03. */
const MAX_BUCKETS = 25;

function count<T extends string | number>(
  papers: readonly Paper[],
  pick: (paper: Paper) => T | T[] | undefined
): FacetBucket[] {
  const counts = new Map<T, number>();

  for (const paper of papers) {
    const value = pick(paper);
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === '') continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([value, n]) => ({ value, count: n }));
}

const byCount = (a: FacetBucket, b: FacetBucket) => b.count - a.count;
const truncate = (buckets: FacetBucket[]) =>
  buckets.length > MAX_BUCKETS ? buckets.slice(0, MAX_BUCKETS) : buckets;

export function generateFacets(papers: readonly Paper[]): Facets {
  return {
    // A paper merged from several providers counts once for each of them:
    // "how many results did this provider contribute" is the question the
    // panel asks, and every one of them did contribute it.
    source: count(papers, p => p.sources.map(s => s.provider)).sort(byCount),
    oaStatus: count(papers, p => p.oaStatus).sort(byCount),
    stage: count(papers, p => p.stage).sort(byCount),
    year: count(papers, p => p.year).sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 25),
    venue: truncate(count(papers, p => p.venue).sort(byCount)),
    publisher: truncate(count(papers, p => p.publisher).sort(byCount)),
    topics: truncate(count(papers, p => p.topics).sort(byCount))
  };
}
