import { Suspense } from 'react';
import { headers } from 'next/headers';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { FacetPanel } from '@/components/FacetPanel';
import { SortBar } from '@/components/SortBar';
import { PaginatedResults } from '@/components/PaginatedResults';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
import { ProviderCoverage } from '@/components/ProviderCoverage';
import { SearchError } from '@/components/SearchError';
import { searchPapers } from '@/lib/fetcher';
import { toList, toSingle, toPage, toYear, toSort } from '@/lib/search-params';
import { classifySearchError } from '@/lib/search-error';
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

  if (!query) {
    return <EmptyState type="no-query" />;
  }

  // Every parameter the API's schema constrains is read through a helper that
  // can only produce a value the schema accepts. Passed through raw, a stale
  // bookmark or a hand-edited address reached the API, failed validation, and
  // surfaced as "Search Error" — the service reported broken for a URL that
  // simply asked for something that does not exist. See `toPage`, `toYear` and
  // `toSort` in `lib/search-params.ts`.
  const currentPage = toPage(searchParams.page);
  const yearFrom = toYear(searchParams.yearFrom);
  const yearTo = toYear(searchParams.yearTo);
  const sort = toSort(searchParams.sort);
  const pageSize = 20; // Fixed page size like Web of Science

  const searchParamsObj: SearchParams = {
    q: query,
    page: currentPage,
    pageSize: pageSize,
    sort,
    filters: {
      // `source`, singular, which is what the API field, the facet key and
      // every other filter on this page are called. It read `sources` here and
      // so silently dropped the filter; nothing writes that parameter today,
      // but the source facet group is the obvious next thing to add and it
      // would have written the singular.
      source: toList(searchParams.source),
      yearFrom,
      yearTo,
      oaStatus: toList(searchParams.oaStatus),
      venue: toList(searchParams.venue),
      publisher: toList(searchParams.publisher),
      topics: toList(searchParams.topics),
      publicationType: toList(searchParams.publicationType),
      openAccessOnly: true, // Always active
      year: toList(searchParams.year),
    },
  };

  /**
   * This search is issued by the server, so it carries no address of its own.
   *
   * Passing the incoming chain on is what keeps the API's rate limit keyed on
   * the visitor rather than on the web tier — see `Caller` in `lib/fetcher.ts`.
   * `headers()` is a promise since Next 15, like `searchParams` above.
   */
  const forwardedFor = (await headers()).get('x-forwarded-for') ?? undefined;

  try {
    const results = await searchPapers(searchParamsObj, { forwardedFor });

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
                    bounded={results.bounded}
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
                      results={results.hits}
                      total={results.total}
                      page={currentPage}
                      pageSize={pageSize}
                    />
                  </div>
                </div>
              </div>
            );
  } catch (error) {
    /**
     * One panel used to cover every failure here, so a stale bookmark, a rate
     * limit and a stopped API were the same sentence to the reader — and the
     * 502/504 distinction the API proxy draws so carefully never reaches this
     * path at all, because a server-rendered search does not go through it.
     * `classifySearchError` recovers the distinction from what the client
     * threw; `SearchError` says what each one means. See `lib/search-error.ts`.
     */
    const failure = classifySearchError(error);

    // Kept, and now says which kind it was. The reader gets one of five
    // panels; whoever is reading the logs gets the error and the bucket it
    // was put in, which is what makes a miscategorised failure findable.
    console.error('Search error:', failure, error);

    return <SearchError failure={failure} />;
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
