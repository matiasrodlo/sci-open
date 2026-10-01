'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { QueryParseError, expandSets } from '@open-access-explorer/shared';
import { Button } from '@/components/ui/button';
import { readHistory, rememberLabel, setTexts } from '@/lib/search-history';
import { cn } from '@/lib/utils';

interface AdvancedSearchProps {
  initialQuery?: string;
  onSearch?: (query: string, filters: any) => void;
  /**
   * Every keystroke, for a parent that needs to know what is in the box.
   *
   * `SearchWithHistory` is the one that does: inserting `#2` appends to what
   * the reader has already typed, and without this the parent would be
   * appending to whatever it last handed down — silently discarding anything
   * typed since.
   */
  onQueryChange?: (query: string) => void;
  /**
   * `hero` is the home page's box: the input on its own line, and beneath it
   * a toolbar naming the field tags beside the button. `compact` is one row,
   * for the top of a results page, where the reader has already searched
   * once and the room is the results'.
   */
  variant?: 'hero' | 'compact';
}

/**
 * The search box, which is now also the advanced one.
 *
 * There was an "Advanced Search" tab beside it, and phase 11 removed it rather
 * than repairing it: it built fielded queries — `title:CRISPR AND year:2024` —
 * and nothing on the backend understood one. That comment said what repairing
 * it would take, which was field support in the `Query` AST and in every
 * provider's `translate`, and both now exist. See `query-grammar.ts`.
 *
 * What did not come back is the row builder. The grammar is Web of Science's,
 * so the thing a reader most often wants to do with a fielded query is paste
 * one they already have — from a paper's methods section, a colleague, or a
 * saved WoS search — and a ten-row form is something to be defeated on the way
 * to that. One box takes both: `crispr gene editing` parses exactly as it
 * always did, and `TS=(crispr OR cas9) NOT AU=Doudna` parses as itself.
 *
 * A query that does not parse is a 400 carrying the parser's message and the
 * offset it stopped at, which `SearchError` shows. That is the part the old tab
 * could not do at all — its worked example made arXiv answer HTTP 400 and the
 * reader was told nothing.
 */
export function AdvancedSearchBar({ initialQuery = '', onSearch, onQueryChange, variant = 'hero' }: AdvancedSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  /**
   * A reference to a set that is not there.
   *
   * Shown here rather than sent, because this is the one query error the
   * service could not diagnose if it wanted to: `#3` is resolved against a
   * history that lives in this browser and never leaves it. Everything the
   * grammar rejects is still the API's to report — see `SearchError`.
   */
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    /**
     * `#1 AND #2` becomes the two queries it names, here, before the URL is
     * built. The address then says what was actually asked, which is what lets
     * it be shared or reopened tomorrow and still mean the same search — see
     * `lib/search-history.ts`.
     */
    let expanded: string;
    try {
      expanded = expandSets(trimmed, setTexts(readHistory()));
    } catch (error) {
      if (error instanceof QueryParseError) {
        setProblem(error.message);
        return;
      }
      throw error;
    }
    setProblem(undefined);

    if (onSearch) {
      onSearch(expanded, {});
      return;
    }

    // Carried across the navigation so the history can list the search the way
    // it was written rather than the way it was expanded.
    if (expanded !== trimmed) rememberLabel(trimmed, expanded);

    const params = new URLSearchParams();
    params.set('q', expanded);
    router.push(`/results?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const input = (
    <input
      type="search"
      aria-label="Search open-access papers"
      placeholder="Search papers, or paste a Web of Science query"
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        // The complaint was about the text that is being replaced. Leaving
        // it up tells the reader their correction is broken too, before
        // anything has looked at it.
        setProblem(undefined);
        onQueryChange?.(e.target.value);
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none',
        variant === 'hero' ? 'px-4 pb-2 pt-4' : 'h-11 pl-10 pr-2'
      )}
      aria-invalid={problem ? true : undefined}
      aria-describedby={problem ? 'search-set-problem' : undefined}
    />
  );

  const button = (
    <Button
      onClick={handleSearch}
      size="sm"
      className="gap-1.5 px-3.5"
      disabled={!query.trim()}
    >
      <Search className="h-3.5 w-3.5" aria-hidden="true" />
      Search
    </Button>
  );

  return (
    <div className="w-full space-y-2">
      {/* The box draws the focus ring rather than the input inside it, so the
          ring goes round the button too: they are one control to the eye. */}
      <div
        className={cn(
          'rounded-lg border bg-card transition-shadow focus-within:shadow-[0_0_0_1px_hsl(var(--foreground))]',
          problem ? 'border-destructive' : 'border-foreground/70'
        )}
      >
        {variant === 'hero' ? (
          <>
            {input}
            <div className="flex items-center justify-between gap-3 px-3 pb-3 pl-4">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                Words, or field tags{' '}
                <code className="font-mono text-foreground/80">TS=</code>{' '}
                <code className="font-mono text-foreground/80">AU=</code>{' '}
                <code className="font-mono text-foreground/80">PY=</code> with AND, OR, NOT ·{' '}
                <Link href="/#syntax" className="text-link hover:underline">
                  Syntax
                </Link>
              </p>
              {button}
            </div>
          </>
        ) : (
          <div className="relative flex items-center gap-2 pr-1.5">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            {input}
            {button}
          </div>
        )}
      </div>

      {problem && (
        <p id="search-set-problem" role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
