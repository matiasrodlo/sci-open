'use client';

import { useEffect, useState } from 'react';
import { History, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HISTORY_CHANGED, clearHistory, readHistory, type SearchSet } from '@/lib/search-history';

/**
 * The numbered searches this session has run.
 *
 * Web of Science's search history, and the reason it exists there: a serious
 * query is rarely typed in one go. You search, look, narrow, and then want the
 * third search *and* the first — without retyping either. Numbering them makes
 * that one line, `#1 AND #3`, and that line is itself a query, so it gets a
 * number too.
 *
 * Reading, not just recalling: the count beside each set is what tells you
 * which narrowing actually did something. A set that took 40,000 to 39,800 is a
 * filter that is not filtering.
 *
 * The whole thing is this session's and this browser's — there are no accounts
 * here to hang it on. See `lib/search-history.ts` for why that decides the
 * design rather than merely constraining it.
 */

export function SearchHistory({ onInsert }: { onInsert: (reference: string) => void }) {
  /**
   * Empty on the server and on the first client render, then filled.
   *
   * `sessionStorage` does not exist during the server render, so reading it
   * in the initial state would make the markup React hydrates differ from the
   * markup it produced. Reading in an effect means one frame without the panel,
   * which is the correct trade for a component that is decoration on a page
   * whose point is the results.
   */
  const [sets, setSets] = useState<SearchSet[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setSets(readHistory());
    refresh();

    // `RecordSearch` writes from inside the results boundary, which is a
    // different subtree that renders later. See `HISTORY_CHANGED`.
    window.addEventListener(HISTORY_CHANGED, refresh);
    return () => window.removeEventListener(HISTORY_CHANGED, refresh);
  }, []);

  if (sets.length === 0) return null;

  return (
    <section className="rounded-lg border bg-card" aria-labelledby="search-history-heading">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-medium"
          aria-expanded={open}
          aria-controls="search-history-list"
        >
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span id="search-history-heading">
            Search history ({sets.length})
          </span>
        </button>

        {open && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSets(clearHistory())}
            className="h-7 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div id="search-history-list" className="border-t">
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Combine them by number — <code className="font-mono">#1 AND #2</code>,{' '}
            <code className="font-mono">#1 NOT #3</code>.
          </p>

          <ul className="divide-y">
            {/* Newest first: the set you want to combine is usually the last one
                you ran, and a long history should not push it off the bottom. */}
            {[...sets].reverse().map(set => (
              <li key={set.number} className="flex items-center gap-3 px-4 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => onInsert(`#${set.number}`)}
                  className="flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs hover:bg-accent"
                  aria-label={`Add #${set.number} to the search box`}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />#{set.number}
                </button>

                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={set.label}>
                  {set.label}
                </code>

                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {set.total === undefined ? '—' : set.total.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
