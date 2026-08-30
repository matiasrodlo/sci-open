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
    <div className="flex items-center gap-3 pb-4 border-b">
      <span id="sort-label" className="text-xs text-muted-foreground uppercase tracking-wide">
        Sort:
      </span>
      <div className="flex gap-2" role="group" aria-labelledby="sort-label">
        {PRIMARY.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => updateSort(option.value)}
            aria-pressed={currentSort === option.value}
            className={`text-sm px-3 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              currentSort === option.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
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
            className={`text-sm px-3 py-1 rounded transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              inDropdown ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            More
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {open && (
            <div
              ref={panelRef}
              role="menu"
              aria-label="More sort options"
              className="absolute top-full left-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 min-w-[200px] py-1"
            >
              {ADDITIONAL.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentSort === option.value}
                  onClick={() => updateSort(option.value)}
                  className={`w-full text-left text-sm px-3 py-2 transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    currentSort === option.value
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <option.icon className="w-4 h-4" aria-hidden="true" />
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
