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
import { toList, toSingle, toPage } from '@/lib/search-params';
import { SearchParams } from '@open-access-explorer/shared';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The query string, once resolved. */
type ResultsSearchParams = { [key: string]: string | string[] | undefined };

/**
 * `searchParams` is a promise since Next 15. It is awaited once, in the page,
 * and the resolved object is passed down — rather than threading the promise
 * through and awaiting it twice for the two things that read it.
 *
 * Awaiting it here does not cost the streaming this page is arranged for. The
 * slow part is the search itself, and that stays inside `ResultsContent` behind
 * its own Suspense boundary; the query string resolves immediately.
 */
interface ResultsPageProps {
  searchParams: Promise<ResultsSearchParams>;
}

async function ResultsContent({ searchParams }: { searchParams: ResultsSearchParams }) {
  // Multi-valued filters arrive as repeated parameters, so they are read with
  // `toList` rather than split on a comma. See `lib/search-params.ts` — a
  // venue like `Bioinformatics (Oxford, England)` cannot survive comma-joining.
  const query = toSingle(searchParams.q);
  const yearFrom = toSingle(searchParams.yearFrom);
  const yearTo = toSingle(searchParams.yearTo);
  const sort = toSingle(searchParams.sort);

  if (!query) {
    return <EmptyState type="no-query" />;
  }

  // Clamped rather than passed through — an out-of-range page used to reach the
  // API, fail its schema, and surface as "Search Error". See `toPage`.
  const currentPage = toPage(searchParams.page);
  const pageSize = 20; // Fixed page size like Web of Science

  const searchParamsObj: SearchParams = {
    q: query,
    page: currentPage,
    pageSize: pageSize,
    sort: (sort as any) || 'relevance',
    filters: {
      // `source`, singular, which is what the API field, the facet key and
      // every other filter on this page are called. It read `sources` here and
      // so silently dropped the filter; nothing writes that parameter today,
      // but the source facet group is the obvious next thing to add and it
      // would have written the singular.
      source: toList(searchParams.source),
      yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
      yearTo: yearTo ? parseInt(yearTo) : undefined,
      oaStatus: toList(searchParams.oaStatus),
      venue: toList(searchParams.venue),
      publisher: toList(searchParams.publisher),
      topics: toList(searchParams.topics),
      publicationType: toList(searchParams.publicationType),
      openAccessOnly: true, // Always active
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

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const params = await searchParams;

  // Create a unique key from search params to force re-render
  const searchKey = JSON.stringify(params);
  const query = (params.q as string) || '';
  
  return (
    <div className="space-y-8">
      <Suspense fallback={<div className="h-14 bg-muted/20 rounded-lg animate-pulse" />}>
        <AdvancedSearchBar initialQuery={query} />
      </Suspense>
      
      <Suspense key={searchKey} fallback={<LoadingSkeleton />}>
        <ResultsContent searchParams={params} />
      </Suspense>
    </div>
  );
}
