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
  /**
   * The source whose own count this is, by display name, when it is one.
   *
   * Such a count is across everything that source holds, not across what was
   * read — and it is a floor, since the other sources hold papers it does not.
   * Shown with a `+`, as the header shows its own floor.
   */
  from?: string;
};

export function sourceCountNote(source: string): string {
  return `At least this many: ${source}’s own count. The sources overlap, so their counts are not added up — together they hold more.`;
}

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
    <div role="group" aria-labelledby={headingId} className="border-t pt-4">
      <h3 id={headingId} className="mb-2.5 text-[13px] font-semibold text-foreground">
        {title}
      </h3>
      <div className="space-y-0.5">
        {options.map(option => {
          const checked = selected.includes(option.value);
          // The value goes through `encodeURIComponent` because it lands in a
          // DOM id, where a raw journal name would be neither unique nor valid.
          const id = `${param}-${encodeURIComponent(option.value)}`;

          return (
            <div
              key={option.value}
              className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
            >
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
                className={`min-w-0 flex-1 cursor-pointer text-[13px] leading-5 ${checked ? 'font-medium text-foreground' : 'text-foreground/85'} ${truncate ? 'truncate' : ''}`}
                {...(truncate ? { title: option.label ?? option.value } : {})}
              >
                {option.label ?? option.value}
              </label>
              <span
                className="shrink-0 text-xs tabular-nums text-muted-foreground"
                {...(option.from ? { title: sourceCountNote(option.from) } : {})}
              >
                {option.count.toLocaleString()}
                {option.from ? '+' : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
