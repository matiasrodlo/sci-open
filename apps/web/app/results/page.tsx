import { Suspense } from 'react';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { FacetPanel } from '@/components/FacetPanel';
import { SortBar } from '@/components/SortBar';
import { InfiniteResults } from '@/components/InfiniteResults';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { SearchHelp } from '@/components/SearchHelp';
import { searchPapers } from '@/lib/fetcher';
import { SearchParams } from '@open-access-explorer/shared';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ResultsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

async function ResultsContent({ searchParams }: ResultsPageProps) {
  const query = searchParams.q as string;
  const sources = searchParams.sources as string;
  const yearFrom = searchParams.yearFrom as string;
  const yearTo = searchParams.yearTo as string;
  const sort = searchParams.sort as string;
  const oaStatus = searchParams.oaStatus as string;
  const year = searchParams.year as string;
  const venue = searchParams.venue as string;

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
      oaStatus: oaStatus ? oaStatus.split(',') : undefined,
      venue: venue ? venue.split(',') : undefined,
      // @ts-ignore - pass year as array for exact matching
      year: year ? year.split(',') : undefined,
    },
  };

  try {
    const results = await searchPapers(searchParamsObj);
    
    if (results.hits.length === 0) {
      return <EmptyState type="no-results" />;
    }

    const currentFilters = {
      sources: sources ? sources.split(',') : ['arxiv', 'core', 'europepmc', 'ncbi', 'doaj'],
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
    };

            return (
              <div className="space-y-6">
                {/* Results Header */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-bold">"{query}"</h1>
                    <p className="text-muted-foreground">
                      Found {results.total} papers
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Facets */}
                  <div className="lg:col-span-1">
                    <FacetPanel facets={results.facets} currentFilters={currentFilters} />
                  </div>

                  {/* Results */}
                  <div className="lg:col-span-2 space-y-4">
                    <SortBar />
                    <InfiniteResults 
                      initialResults={results.hits}
                      initialTotal={results.total}
                      searchParams={searchParamsObj}
                    />
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
  // Create a unique key from search params to force re-render
  const searchKey = JSON.stringify(searchParams);
  const query = (searchParams.q as string) || '';
  
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-14 bg-muted/20 rounded-lg animate-pulse" />}>
        <AdvancedSearchBar initialQuery={query} />
      </Suspense>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <SearchHelp />
        </div>
        <div className="lg:col-span-3">
          <Suspense key={searchKey} fallback={<LoadingSkeleton />}>
            <ResultsContent searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
