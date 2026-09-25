import type { CountedFacet, Paper, ProviderId, SourceFacets } from '@open-access-explorer/shared';
import { matchesFilters, passesPolicy, type PolicyOptions, type UserFilters } from './policy';
import { facetKey } from './facet-key';

export { facetKey };

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

export type FacetBucket = {
  value: string | number;
  count: number;
  /**
   * The source whose own count this is, when it is one — the largest single
   * source's count across everything it matches, which beat what this search
   * read. Absent when the count was taken from the read. See
   * `withSourceCounts`.
   */
  from?: ProviderId;
};
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

/**
 * Counts papers per value, one bucket per `facetKey`, labelled with the
 * spelling most of its papers carry — the first seen, on a tie, which in a
 * ranked set is the better-ranked paper's.
 */
function count<T extends string | number>(
  papers: readonly Paper[],
  pick: (paper: Paper) => T | T[] | undefined
): FacetBucket[] {
  const buckets = new Map<string, { count: number; spellings: Map<T, number> }>();

  for (const paper of papers) {
    const value = pick(paper);
    if (value === undefined) continue;
    // A paper carrying two spellings of one topic counts once for it.
    const seen = new Set<string>();
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === '') continue;
      const key = facetKey(v);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      const bucket = buckets.get(key) ?? { count: 0, spellings: new Map<T, number>() };
      bucket.count += 1;
      bucket.spellings.set(v, (bucket.spellings.get(v) ?? 0) + 1);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()].map(({ count: n, spellings }) => {
    let label: T | undefined;
    let most = 0;
    for (const [spelling, times] of spellings) {
      if (times > most) {
        label = spelling;
        most = times;
      }
    }
    return { value: label!, count: n };
  });
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
    source: arrange('source', count(over('source'), p => [...new Set(p.sources.map(s => s.provider))])),
    oaStatus: arrange('oaStatus', count(over('oaStatus'), p => p.oaStatus)),
    stage: arrange('stage', count(over('stage'), p => p.stage)),
    year: arrange('year', count(over('year'), p => p.year)),
    venue: arrange('venue', count(over('venue'), p => p.venue)),
    publisher: arrange('publisher', count(over('publisher'), p => p.publisher)),
    topics: arrange('topics', count(over('topics'), p => p.topics))
  };
}

/** How each facet is ordered and cut, shared by the read's counts and the merged ones. */
function arrange(facet: FacetKey, buckets: FacetBucket[]): FacetBucket[] {
  if (facet === 'year') return buckets.sort((a, b) => Number(b.value) - Number(a.value)).slice(0, MAX_BUCKETS);
  const sorted = buckets.sort(byCount);
  return facet === 'venue' || facet === 'publisher' || facet === 'topics' ? truncate(sorted) : sorted;
}

/** One provider's whole-index counts, as `countSourceFacets` returns them. */
export type SourceCounts = { provider: ProviderId; facets: SourceFacets };

/**
 * The read's facets, with each bucket raised to the largest single source's
 * count for that value where that is larger — for the facets in `countable`.
 *
 * The read is the top of each source's answer, so a bucket counted over it
 * says how much of the top is from 2024, not how much from 2024 there is. On
 * `ai` the year facet said 964 for 2026, where OpenAlex alone holds 424,757.
 * The sources can say the second thing, so they are asked to (see
 * `source-facets.ts`), and this is where their answers meet the read's.
 *
 * **The largest, never the sum.** The sources overlap heavily — OpenAlex holds
 * most of what PubMed, arXiv and DOAJ do — so adding their counts would count
 * the same paper several times. The largest single count is the one figure
 * certain not to overstate: the papers from 2024, across all of them, are at
 * least as many as any one of them holds. It is the rule the header already
 * uses for the whole search, applied to each bucket. The read's own count is
 * in the comparison too, since it is also a floor — every paper in it matches.
 *
 * A facet outside `countable` is returned as the read counted it. That is the
 * facet whose count some filter no source could be sent would have to narrow:
 * a source's count of IEEE Access says nothing about how many of those are
 * also in the venue the reader ticked. See `FacetQueries`.
 *
 * A value only a source reports — a journal outside everything read — is
 * added, which is the point: those are the buckets the read could not see.
 * Labelled in the read's spelling where the read has one, so ticking it finds
 * the papers the list holds.
 */
export function withSourceCounts(
  read: Facets,
  sources: readonly SourceCounts[],
  countable: Iterable<CountedFacet>
): Facets {
  const merged: Facets = { ...read };

  for (const facet of countable) {
    const buckets = new Map<string, FacetBucket>();

    for (const bucket of read[facet] ?? []) {
      buckets.set(facetKey(bucket.value), { value: bucket.value, count: bucket.count });
    }

    for (const { provider, facets } of sources) {
      for (const bucket of facets[facet] ?? []) {
        const key = facetKey(bucket.value);
        if (key === '') continue;
        const held = buckets.get(key);
        if (!held) buckets.set(key, { value: bucket.value, count: bucket.count, from: provider });
        else if (bucket.count > held.count) buckets.set(key, { value: held.value, count: bucket.count, from: provider });
      }
    }

    merged[facet] = arrange(facet, [...buckets.values()]);
  }

  return merged;
}
