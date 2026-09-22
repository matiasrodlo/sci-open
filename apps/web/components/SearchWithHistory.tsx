'use client';

import { useState } from 'react';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { SearchHistory } from '@/components/SearchHistory';

/**
 * The search box and the session's numbered searches, which have to be one
 * component because clicking `#2` types into the box.
 *
 * `/results` is a server component and cannot hold that state, so this is the
 * smallest client boundary that covers both. It exists for the wiring and holds
 * no logic of its own: the expansion lives in the shared grammar, the history in
 * `lib/search-history.ts`, and the recording in `RecordSearch`.
 *
 * The draft is tracked on every keystroke rather than only on insertion, and
 * that is not bookkeeping for its own sake: an insertion appends to what is in
 * the box, so a draft that only updated when this component set it would append
 * to a stale string and throw away whatever had been typed since.
 */
export function SearchWithHistory({ initialQuery }: { initialQuery: string }) {
  const [draft, setDraft] = useState(initialQuery);

  /**
   * Appended rather than replacing what is there, because inserting a set is
   * almost always the middle of writing a combination — the reader has `#1 AND`
   * and wants `#2` after it. Text that does not already end in an operator gets
   * an `AND`, since two references side by side would be an implicit one that
   * reads like a typo.
   */
  const insert = (reference: string) => {
    setDraft(text => {
      const trimmed = text.trim();
      if (!trimmed) return reference;
      return /(\bAND|\bOR|\bNOT|\()$/i.test(trimmed)
        ? `${trimmed} ${reference}`
        : `${trimmed} AND ${reference}`;
    });
  };

  return (
    <div className="space-y-3">
      <AdvancedSearchBar initialQuery={draft} onQueryChange={setDraft} />
      <SearchHistory onInsert={insert} />
    </div>
  );
}
