'use client';

import { useEffect } from 'react';
import { record, takeLabel } from '@/lib/search-history';

/**
 * Adds the search that produced this page to the session's numbered history.
 *
 * Rendered inside the results boundary because that is the first place anything
 * knows both halves: the query comes from the URL, which the page has had all
 * along, and the count only exists once the search has come back. The panel
 * that displays the history sits above that boundary so the search box stays
 * usable while results stream, so the two are separate components and the store
 * announces the write — see `HISTORY_CHANGED`.
 *
 * Renders nothing. `record` matches on the expanded query, so paging, sorting
 * and ticking a facet all land on the set that is already there rather than
 * minting another identical number.
 */
export function RecordSearch({ query, total }: { query: string; total: number }) {
  useEffect(() => {
    if (!query.trim()) return;
    // The typed form, when this navigation came from the search box. A reader
    // who opened the URL directly never typed one, and the query stands in.
    record({ label: takeLabel(query) ?? query, expanded: query, total });
  }, [query, total]);

  return null;
}
