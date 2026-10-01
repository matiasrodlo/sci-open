'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
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

/** The parameters the groups below write, for counting what is ticked. */
const PARAMS = ['publicationType', 'year', 'venue', 'publisher', 'topics'] as const;

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

  // Folded on a narrow screen until asked for. See the button below.
  const [open, setOpen] = useState(false);
  const active = PARAMS.reduce((count, param) => count + selected(param).length, 0);

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
    <div className="space-y-4" role="region" aria-label="Filter results">
      {/*
        On a wide screen the column is always open and this is its heading.

        On a narrow one the groups fold behind a button, because they sit
        above the results there and are five groups of checkboxes long. They
        were moved below the list once to get them out of the way, which put
        them under the pagination — nine thousand pixels down a phone, where
        nobody looks for a filter — and put them after every result in the
        tab order on a desktop that shows them first. Folded, they stay first
        in both orders and cost one line.
      */}
      <h2 className="hidden items-center gap-2 text-sm font-semibold lg:flex">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filters
      </h2>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="facet-groups"
        className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters
          {active > 0 && (
            <span className="rounded-full bg-foreground px-1.5 text-xs leading-5 text-background">
              <span className="sr-only">, </span>
              {active}
              <span className="sr-only"> selected</span>
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div id="facet-groups" className={`space-y-4 ${open ? '' : 'hidden lg:block'}`}>
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
    </div>
  );
}
