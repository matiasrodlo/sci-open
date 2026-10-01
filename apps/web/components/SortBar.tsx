'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpDown, Calendar, TrendingUp, User, BookOpen, FileText, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

type SortOption = 'relevance' | 'date' | 'date_asc' | 'citations' | 'citations_asc' | 'author' | 'author_desc' | 'venue' | 'venue_desc' | 'title' | 'title_desc';

const PRIMARY = [
  { value: 'relevance' as const, label: 'Relevance', icon: ArrowUpDown },
  { value: 'date' as const, label: 'Date (Newest)', icon: Calendar },
  { value: 'citations' as const, label: 'Citations', icon: TrendingUp }
];

const ADDITIONAL = [
  { value: 'date_asc' as const, label: 'Date (Oldest)', icon: Calendar },
  { value: 'citations_asc' as const, label: 'Citations (Lowest)', icon: TrendingUp },
  { value: 'author' as const, label: 'Author (A-Z)', icon: User },
  { value: 'author_desc' as const, label: 'Author (Z-A)', icon: User },
  { value: 'venue' as const, label: 'Venue (A-Z)', icon: BookOpen },
  { value: 'venue_desc' as const, label: 'Venue (Z-A)', icon: BookOpen },
  { value: 'title' as const, label: 'Title (A-Z)', icon: FileText },
  { value: 'title_desc' as const, label: 'Title (Z-A)', icon: FileText }
];

/**
 * The sort control.
 *
 * The "More" dropdown is hand-rolled rather than a Radix primitive, so nothing
 * made it accessible for free — and it had no `aria-*` and no `role` at all.
 * A screen reader announced eight unlabelled buttons appearing from nowhere,
 * and a keyboard user could tab into the list but not close it, because
 * dismissal was bound to `mousedown` outside.
 *
 * What it needs is small and specific: the trigger says it is a menu and
 * whether it is open, the panel is a `menu` of `menuitemradio`s that report
 * which one is chosen, Escape closes and returns focus to the trigger, and
 * focus moves into the panel when it opens so the items are reachable in the
 * order they appear.
 */
export function SortBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = (searchParams.get('sort') as SortOption) || 'relevance';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        // Focus goes back where it came from, or it is lost on the document.
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector('button')?.focus();
  }, [open]);

  const updateSort = (sort: SortOption) => {
    const params = new URLSearchParams(searchParams);
    if (sort === 'relevance') params.delete('sort');
    else params.set('sort', sort);
    // A re-sort reorders the whole set, so page 12 of the old order means
    // nothing in the new one.
    params.delete('page');
    router.push(`/results?${params.toString()}`);
    setOpen(false);
  };

  const inDropdown = ADDITIONAL.some(option => option.value === currentSort);
  const currentLabel = [...PRIMARY, ...ADDITIONAL].find(o => o.value === currentSort)?.label ?? 'Relevance';

  return (
    <div className="flex items-center gap-3 border-b pb-3">
      <span id="sort-label" className="shrink-0 text-[13px] text-muted-foreground">
        Sort by
      </span>
      <div className="flex flex-wrap gap-1" role="group" aria-labelledby="sort-label">
        {PRIMARY.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => updateSort(option.value)}
            aria-pressed={currentSort === option.value}
            className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              currentSort === option.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}

        <div className="relative" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(!open)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`More sort options, currently sorted by ${currentLabel}`}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              inDropdown ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {/* The chosen option by name when it is one of these, or the
                pill that lights up says only "More". */}
            {inDropdown ? currentLabel : 'More'}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {open && (
            <div
              ref={panelRef}
              role="menu"
              aria-label="More sort options"
              className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border bg-popover py-1 shadow-lg shadow-black/5"
            >
              {ADDITIONAL.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentSort === option.value}
                  onClick={() => updateSort(option.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    currentSort === option.value
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
