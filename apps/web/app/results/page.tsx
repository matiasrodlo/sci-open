import { Suspense } from 'react';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { FacetPanel } from '@/components/FacetPanel';
import { SortBar } from '@/components/SortBar';
import { PaginatedResults } from '@/components/PaginatedResults';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
import { ProviderCoverage } from '@/components/ProviderCoverage';
import { searchPapers } from '@/lib/fetcher';
import { toList, toSingle } from '@/lib/search-params';
import { SearchParams } from '@open-access-explorer/shared';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ResultsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

async function ResultsContent({ searchParams }: ResultsPageProps) {
  // Multi-valued filters arrive as repeated parameters, so they are read with
  // `toList` rather than split on a comma. See `lib/search-params.ts` — a
  // venue like `Bioinformatics (Oxford, England)` cannot survive comma-joining.
  const query = toSingle(searchParams.q);
  const yearFrom = toSingle(searchParams.yearFrom);
  const yearTo = toSingle(searchParams.yearTo);
  const sort = toSingle(searchParams.sort);
  const page = toSingle(searchParams.page);

  if (!query) {
    return <EmptyState type="no-query" />;
  }

  const currentPage = parseInt(page ?? '') || 1;
  const pageSize = 20; // Fixed page size like Web of Science

  const searchParamsObj: SearchParams = {
    q: query,
    page: currentPage,
    pageSize: pageSize,
    sort: (sort as any) || 'relevance',
    filters: {
      source: toList(searchParams.sources),
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
      oaStatus: toList(searchParams.oaStatus),
      venue: toList(searchParams.venue),
      publisher: toList(searchParams.publisher),
      topics: toList(searchParams.topics),
      publicationType: toList(searchParams.publicationType),
      openAccessOnly: true, // Always active
      // @ts-expect-error - pass year as array for exact matching
      year: toList(searchParams.year),
    },
  };

  try {
    const results = await searchPapers(searchParamsObj);
    
    if (results.hits.length === 0) {
      return <EmptyState type="no-results" />;
    }

            return (
              <div className="space-y-8">
                {/* Results Header */}
                <div className="border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-3">
                      <h1 className="text-xl font-semibold">{query}</h1>
                      <span className="text-sm text-muted-foreground">
                        {results.total.toLocaleString()} retrievable open-access papers
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

                {results.providerTotals && results.providerTotals.length > 0 && (
                  <ProviderCoverage
                    providers={results.providerTotals}
                    complete={results.complete}
                  />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  {/* Facets */}
                  <div className="lg:col-span-1">
                    <FacetPanel facets={results.facets} />
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
