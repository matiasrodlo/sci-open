'use client';

import { Checkbox } from '@/components/ui/checkbox';

/**
 * One block of the facet panel.
 *
 * Five near-identical copies of this used to sit inline in `FacetPanel` —
 * publication type, year, venue, publisher and topics — differing only in
 * their heading, their query parameter and how many buckets they showed. Each
 * copy carried its own inline `onCheckedChange` that re-derived the current
 * selection by splitting a comma-joined parameter, which is five places for
 * the same encoding bug to live.
 */

export type FacetOption = {
  /** What goes in the URL. */
  value: string;
  /** What the reader sees. Defaults to the value. */
  label?: string;
  count: number;
};

interface FacetGroupProps {
  title: string;
  /** The query parameter this group writes to. */
  param: string;
  options: FacetOption[];
  /** Values currently selected, read from the URL by the panel. */
  selected: readonly string[];
  onToggle: (param: string, values: string[]) => void;
  /** Whether a long value should be truncated with the full text on hover. */
  truncate?: boolean;
}

export function FacetGroup({
  title,
  param,
  options,
  selected,
  onToggle,
  truncate = false
}: FacetGroupProps) {
  if (options.length === 0) return null;

  const headingId = `facet-${param}-heading`;

  return (
    <div role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      <div className="space-y-2">
        {options.map(option => {
          const checked = selected.includes(option.value);
          // The value goes through `encodeURIComponent` because it lands in a
          // DOM id, where a raw journal name would be neither unique nor valid.
          const id = `${param}-${encodeURIComponent(option.value)}`;

          return (
            <div key={option.value} className="flex items-center space-x-2">
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(next: boolean) =>
                  onToggle(
                    param,
                    next
                      ? [...selected, option.value]
                      : selected.filter(v => v !== option.value)
                  )
                }
              />
              <label
                htmlFor={id}
                className={`text-sm leading-none flex-1 cursor-pointer ${truncate ? 'truncate' : ''}`}
                {...(truncate ? { title: option.label ?? option.value } : {})}
              >
                {option.label ?? option.value}
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {option.count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
