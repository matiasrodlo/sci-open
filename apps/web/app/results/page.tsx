import { Suspense } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { FacetPanel } from '@/components/FacetPanel';
import { SortBar } from '@/components/SortBar';
import { ResultCard } from '@/components/ResultCard';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { searchPapers } from '@/lib/fetcher';
import { SearchParams } from '@open-access-explorer/shared';

interface ResultsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

async function ResultsContent({ searchParams }: ResultsPageProps) {
  const query = searchParams.q as string;
  const sources = searchParams.sources as string;
  const yearFrom = searchParams.yearFrom as string;
  const yearTo = searchParams.yearTo as string;
  const sort = searchParams.sort as string;

  if (!query) {
    return <EmptyState type="no-query" />;
  }

  const searchParamsObj: SearchParams = {
    q: query,
    page: 1,
    pageSize: 20,
    sort: (sort as any) || 'relevance',
    filters: {
      source: sources ? sources.split(',') : undefined,
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
    },
  };

  try {
    const results = await searchPapers(searchParamsObj);
    
    if (results.hits.length === 0) {
      return <EmptyState type="no-results" />;
    }

    const currentFilters = {
      sources: sources ? sources.split(',') : ['arxiv', 'core', 'europepmc', 'ncbi'],
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
    };

    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <FacetPanel facets={results.facets} currentFilters={currentFilters} />
          <div className="flex-1">
            <SortBar />
            <div className="space-y-4">
              {results.hits.map((record) => (
                <ResultCard key={record.id} record={record} />
              ))}
            </div>
            {results.total > results.hits.length && (
              <div className="text-center mt-8">
                <p className="text-sm text-muted-foreground">
                  Showing {results.hits.length} of {results.total} results
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Search error:', error);
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-semibold mb-2">Search Error</h3>
        <p className="text-muted-foreground">
          There was an error performing your search. Please try again.
        </p>
      </div>
    );
  }
}

export default function ResultsPage({ searchParams }: ResultsPageProps) {
  return (
    <div className="space-y-6">
      <SearchBar />
      <Suspense fallback={<LoadingSkeleton />}>
        <ResultsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
