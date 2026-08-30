'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FacetGroup, type FacetOption } from '@/components/FacetGroup';
import { withFilter } from '@/lib/search-params';

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

type Bucket = { value: string | number; count: number };

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
    .map(bucket => ({ value: String(bucket.value), count: Number(bucket.count) || 0 }))
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
   * Roll the per-source counts up into the two publication types. Sources the
   * backend does not classify (and so cannot filter on) fall into neither
   * bucket, which is why these two need not add up to the total.
   */
  const publicationTypeOptions = (): FacetOption[] => {
    const buckets: Bucket[] = Array.isArray(facets.source) ? facets.source : [];
    const counts = { 'peer-reviewed': 0, preprint: 0 };

    for (const bucket of buckets) {
      const source = String(bucket.value);
      const count = Number(bucket.count) || 0;
      if (source === 'europepmc' || source === 'ncbi') counts['peer-reviewed'] += count;
      else if (source === 'arxiv') counts.preprint += count;
    }

    return [
      { value: 'peer-reviewed', label: 'Peer Reviewed', count: counts['peer-reviewed'] },
      { value: 'preprint', label: 'Pre-print', count: counts.preprint }
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
