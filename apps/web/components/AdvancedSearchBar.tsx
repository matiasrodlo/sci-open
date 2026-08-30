'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdvancedSearchProps {
  initialQuery?: string;
  onSearch?: (query: string, filters: any) => void;
}

/**
 * The search box.
 *
 * There was an "Advanced Search" tab beside it, and phase 11 removed it rather
 * than repairing it. It built fielded queries — `title:CRISPR AND year:2024`,
 * eight fields and three operators over up to ten rows — and nothing on the
 * backend has ever understood one. `parseQuery` recognises quoted phrases,
 * bare terms and DOIs; a `title:` prefix reaches the providers as a literal
 * term, and its own help popover's worked example makes arXiv answer HTTP 400.
 *
 * Making it real is not frontend work: it needs field support in the `Query`
 * AST and in every provider's `translate`, several of which cannot express a
 * field search at all. Leaving a control on screen that quietly does something
 * other than what it says is worse than not offering it, so the tab, the row
 * builder and the help popover are gone together — the popover documented the
 * same syntax and would have outlived the thing it described.
 *
 * The component keeps its name because the route imports it, and keeps the
 * `onSearch` escape hatch it already had.
 */
export function AdvancedSearchBar({ initialQuery = '', onSearch }: AdvancedSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (onSearch) {
      onSearch(trimmed, {});
      return;
    }

    const params = new URLSearchParams();
    params.set('q', trimmed);
    router.push(`/results?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="relative">
        <Search
          className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search open-access papers"
          placeholder="Search for papers, authors, topics, or DOIs..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-12 h-14 text-base"
        />
      </div>

      <Button
        onClick={handleSearch}
        size="lg"
        className="w-full h-12 text-base font-semibold gap-2"
        disabled={!query.trim()}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
        Search
      </Button>
    </div>
  );
}
