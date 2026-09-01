import type { Paper } from '@open-access-explorer/shared';
import { matchesFilters, passesPolicy, type PolicyOptions, type UserFilters } from './policy';

/**
 * Facets over the set that produced the hits.
 *
 * The invariant the whole panel rests on: a bucket's count states exactly how
 * far selecting it narrows the result set. Counting over a different set than
 * the one returned is what made the frontend grow heuristics that "corrected"
 * counts it judged implausible, inventing numbers to replace real ones.
 *
 * **A facet is not counted over its own selection.** Every facet used to be
 * counted over the fully filtered set, its own ticked values included — so the
 * moment a reader ticked Year 2022, the year facet held exactly one bucket and
 * 2021 and 2023 vanished from the panel. `FacetGroup` renders what it is given,
 * so there was no way to add a second year, and no way to see that a second one
 * existed. The filters are OR-semantics on this side and the URL carries
 * repeated parameters perfectly well: multi-select was built, and unreachable.
 *
 * The rule that fixes it is the standard one — count each facet over the set
 * every *other* filter admits — and it keeps the invariant rather than trading
 * it away. With OR semantics, ticking a second value widens the set, and what
 * the reader needs beside an unticked bucket is how many results it would bring
 * in given everything else they have chosen. That is what this now counts.
 */

export type FacetBucket = { value: string | number; count: number };
export type Facets = Record<string, FacetBucket[]>;

/** The facets this module produces, and the filter each one's checkboxes write to. */
const OWN_FILTER = {
  source: 'source',
  oaStatus: 'oaStatus',
  stage: 'stage',
  year: 'year',
  venue: 'venue',
  publisher: 'publisher',
  topics: 'topics'
} as const satisfies Record<string, keyof UserFilters>;

export type FacetKey = keyof typeof OWN_FILTER;

/** The set to count one facet over, where it differs from the returned set. */
export type FacetBases = Partial<Record<FacetKey, readonly Paper[]>>;

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

/**
 * The set each facet is counted over: everything the other filters admit, with
 * that one facet's own selection lifted.
 *
 * Only built for facets the caller has actually ticked something in. With no
 * filters — the common case — this returns nothing and every facet is counted
 * over the returned set exactly as before.
 *
 * `admitted` carries the papers the pipeline has already settled: those that
 * passed the gate outright and those the rescue bought back, in the enriched
 * form it produced. A paper outside the current selection was never a rescue
 * candidate — the rescue runs on what matches the filters, bounded, and asking
 * about the rest is the per-record cost this pipeline is arranged to avoid — so
 * it is judged on what the providers said, which is what its count would have
 * been with no rescue at all. The effect is confined to unticked buckets in an
 * active facet, and it can only understate them.
 */
export function facetBaseSets(
  ranked: readonly Paper[],
  filters: UserFilters = {},
  policy: PolicyOptions = {},
  admitted: ReadonlyMap<string, Paper> = new Map()
): FacetBases {
  const bases: FacetBases = {};

  for (const facet of Object.keys(OWN_FILTER) as FacetKey[]) {
    const key = OWN_FILTER[facet];
    const selected = filters[key];
    if (!Array.isArray(selected) || selected.length === 0) continue;

    const others: UserFilters = { ...filters };
    delete others[key];

    bases[facet] = ranked.flatMap(paper => {
      if (!matchesFilters(paper, others)) return [];
      const settled = admitted.get(paper.id);
      if (settled) return [settled];
      return passesPolicy(paper, policy) ? [paper] : [];
    });
  }

  return bases;
}

export function generateFacets(papers: readonly Paper[], bases: FacetBases = {}): Facets {
  const over = (facet: FacetKey): readonly Paper[] => bases[facet] ?? papers;

  return {
    // A paper merged from several providers counts once for each of them:
    // "how many results did this provider contribute" is the question the
    // panel asks, and every one of them did contribute it.
    //
    // Deduplicated per paper, because `sources` is keyed by provider *and*
    // native id: a provider that returned the same work twice under two of its
    // own ids leaves two refs on the merged paper, and counting refs rather
    // than papers made the bucket exceed the number of results filtering by it
    // returns. Measured on "alzheimer amyloid": Europe PMC retrieved 600
    // records that merged into 584 papers, and the bucket read 600 against a
    // total of 584 in the same response.
    source: count(over('source'), p => [...new Set(p.sources.map(s => s.provider))]).sort(byCount),
    oaStatus: count(over('oaStatus'), p => p.oaStatus).sort(byCount),
    stage: count(over('stage'), p => p.stage).sort(byCount),
    year: count(over('year'), p => p.year).sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 25),
    venue: truncate(count(over('venue'), p => p.venue).sort(byCount)),
    publisher: truncate(count(over('publisher'), p => p.publisher).sort(byCount)),
    topics: truncate(count(over('topics'), p => p.topics).sort(byCount))
  };
}
