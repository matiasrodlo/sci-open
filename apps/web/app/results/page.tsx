import { Suspense } from 'react';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { FacetPanel } from '@/components/FacetPanel';
import { SortBar } from '@/components/SortBar';
import { PaginatedResults } from '@/components/PaginatedResults';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
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
  const publisher = searchParams.publisher as string;
  const topics = searchParams.topics as string;
  const page = searchParams.page as string;

  if (!query) {
    return <EmptyState type="no-query" />;
  }

  const currentPage = parseInt(page as string) || 1;
  const pageSize = 20; // Fixed page size like Web of Science

  const searchParamsObj: SearchParams = {
    q: query,
    page: currentPage,
    pageSize: pageSize,
    sort: (sort as any) || 'relevance',
    filters: {
      source: sources ? sources.split(',') : undefined,
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
      oaStatus: oaStatus ? oaStatus.split(',') : undefined,
      venue: venue ? venue.split(',') : undefined,
      publisher: publisher ? publisher.split(',') : undefined,
      topics: topics ? topics.split(',') : undefined,
      openAccessOnly: true, // Always active
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
              <div className="space-y-8">
                {/* Results Header */}
                <div className="border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-3">
                      <h1 className="text-xl font-semibold">{query}</h1>
                      <span className="text-sm text-muted-foreground">
                        {results.total.toLocaleString()} results
                      </span>
                    </div>
                    <ExportButton 
                      results={results.hits} 
                      query={query} 
                      totalResults={results.total}
                      currentPage={currentPage}
                      pageSize={pageSize}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  {/* Facets */}
                  <div className="lg:col-span-1">
                    <FacetPanel facets={results.facets} currentFilters={currentFilters} />
                  </div>

                  {/* Results */}
                  <div className="lg:col-span-3 space-y-6">
                    <SortBar />
                    <PaginatedResults 
                      initialResults={results.hits}
                      initialTotal={results.total}
                      initialPage={currentPage}
                      initialPageSize={pageSize}
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
    <div className="space-y-8">
      <Suspense fallback={<div className="h-14 bg-muted/20 rounded-lg animate-pulse" />}>
        <AdvancedSearchBar initialQuery={query} />
      </Suspense>
      
      <Suspense key={searchKey} fallback={<LoadingSkeleton />}>
        <ResultsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
