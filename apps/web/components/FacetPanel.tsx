'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FacetGroup, type FacetOption } from '@/components/FacetGroup';
import { withFilter } from '@/lib/search-params';
import { providerLabel } from '@/lib/provider-labels';

interface FacetPanelProps {
  facets: Record<string, any>;
}

/**
 * `currentFilters` used to be a second prop here, carrying the selected
 * sources and year bounds. Its only reader was a `toggleSource` handler that
 * no JSX ever rendered — there is no source facet group — so the panel took a
 * prop, the results page computed it on every render, and nothing used either.
 * Both are gone. Filtering by source remains unreachable from the UI, exactly
 * as it already was.
 */

/** Common publisher name mappings for better display. */
const PUBLISHER_LABELS: Record<string, string> = {
  'Nature Publishing Group': 'Nature',
  'Oxford University Press': 'Oxford UP',
  'Cambridge University Press': 'Cambridge UP'
};

/** `from` is set when the count is a source's own rather than the read's. See `FacetBucket` in the API. */
type Bucket = { value: string | number; count: number; from?: string };

/** Facet buckets as the panel wants them: sorted, capped, labelled. */
function toOptions(
  buckets: Bucket[] | undefined,
  limit: number,
  options: { sort?: 'count' | 'valueDesc'; label?: (value: string) => string } = {}
): FacetOption[] {
  if (!Array.isArray(buckets)) return [];

  const { sort = 'count', label } = options;

  return buckets
    .filter(bucket => bucket && bucket.value !== undefined && bucket.value !== null && `${bucket.value}` !== '')
    .map(bucket => ({
      value: String(bucket.value),
      count: Number(bucket.count) || 0,
      ...(bucket.from ? { from: providerLabel(bucket.from) } : {})
    }))
    .sort((a, b) =>
      sort === 'valueDesc' ? Number(b.value) - Number(a.value) : b.count - a.count
    )
    .slice(0, limit)
    .map(bucket => ({ ...bucket, ...(label ? { label: label(bucket.value) } : {}) }));
}

export function FacetPanel({ facets }: FacetPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * Writes one filter and navigates.
   *
   * Repeated parameters, and `page` dropped — both in `withFilter`, so the
   * five groups cannot disagree about either.
   */
  const setFilter = (param: string, values: string[]) => {
    router.push(`/results?${withFilter(searchParams, param, values).toString()}`);
  };

  const selected = (param: string) => searchParams.getAll(param);

  /**
   * Roll the stage counts up into the two publication types.
   *
   * These are counted from `facets.stage` because that is what the filter runs
   * on: the API maps `publicationType` to stages — peer-reviewed to `accepted`
   * and `published`, pre-print to `preprint` — so counting anything else makes
   * the number beside a box disagree with what ticking it returns.
   *
   * It used to roll up `facets.source` against a hardcoded three-provider map:
   * europepmc and ncbi to peer-reviewed, arxiv to pre-print, and the other
   * seven providers to neither. On one measured search that showed "Peer
   * Reviewed 1,100" where the stages said 1,769 — plos, doaj and openaire are
   * peer-reviewed journal sources and were all being dropped — and "Pre-print
   * 0" against an actual 5, because arXiv had contributed nothing to that
   * search while preprints had arrived through other providers. A zero next to
   * a box that returns five results is the worse half of that.
   *
   * They still need not add up to the total: a paper whose stage is `unknown`
   * is in neither bucket, and cannot be filtered to either.
   */
  const publicationTypeOptions = (): FacetOption[] => {
    const buckets: Bucket[] = Array.isArray(facets.stage) ? facets.stage : [];
    const byStage: Record<string, Bucket> = {};

    for (const bucket of buckets) {
      byStage[String(bucket.value)] = bucket;
    }

    // Two disjoint stages, so their floors add to a floor of both. Named after
    // the source of the larger half, which is the one the reader would ask about.
    const reviewed = [byStage.accepted, byStage.published].filter((b): b is Bucket => !!b);
    const reviewedFrom = [...reviewed].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
      .find(b => b.from)?.from;

    return [
      {
        value: 'peer-reviewed',
        label: 'Peer Reviewed',
        count: reviewed.reduce((sum, b) => sum + (Number(b.count) || 0), 0),
        ...(reviewedFrom ? { from: providerLabel(reviewedFrom) } : {})
      },
      {
        value: 'preprint',
        label: 'Pre-print',
        count: Number(byStage.preprint?.count) || 0,
        ...(byStage.preprint?.from ? { from: providerLabel(byStage.preprint.from) } : {})
      }
    ];
  };

  return (
    <div className="space-y-6" role="region" aria-label="Filter results">
      <FacetGroup
        title="Publication Type"
        param="publicationType"
        options={publicationTypeOptions()}
        selected={selected('publicationType')}
        onToggle={setFilter}
      />

      <FacetGroup
        title="Year"
        param="year"
        options={toOptions(facets.year, 10, { sort: 'valueDesc' })}
        selected={selected('year')}
        onToggle={setFilter}
      />

      <FacetGroup
        title="Venue"
        param="venue"
        options={toOptions(facets.venue, 10)}
        selected={selected('venue')}
        onToggle={setFilter}
        truncate
      />

      <FacetGroup
        title="Publisher"
        param="publisher"
        options={toOptions(facets.publisher, 10, {
          label: value => PUBLISHER_LABELS[value] ?? value
        })}
        selected={selected('publisher')}
        onToggle={setFilter}
        truncate
      />

      <FacetGroup
        title="Topics"
        param="topics"
        options={toOptions(facets.topics, 15)}
        selected={selected('topics')}
        onToggle={setFilter}
        truncate
      />
    </div>
  );
}
