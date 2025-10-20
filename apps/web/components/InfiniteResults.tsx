'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ResultCard } from '@/components/ResultCard';
import { OARecord, SearchParams } from '@open-access-explorer/shared';
import { searchPapers } from '@/lib/fetcher';
import { Loader2 } from 'lucide-react';

interface InfiniteResultsProps {
  initialResults: OARecord[];
  initialTotal: number;
  searchParams: SearchParams;
}

export function InfiniteResults({ 
  initialResults, 
  initialTotal, 
  searchParams 
}: InfiniteResultsProps) {
  // Create a stable key from search params to detect changes
  const searchKey = JSON.stringify({
    q: searchParams.q,
    sort: searchParams.sort,
    filters: searchParams.filters
  });

  const [results, setResults] = useState<OARecord[]>(initialResults);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialResults.length < initialTotal);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  // Backend now filters to only include papers with PDFs
  // No need for additional filtering here
  const filteredResults = results;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    try {
      const nextPage = page + 1;
      const nextResults = await searchPapers({
        ...searchParams,
        page: nextPage,
      });

      // Check if we got new results
      if (nextResults.hits.length === 0) {
        setHasMore(false);
        setLoading(false);
        return;
      }

      setResults(prev => {
        // Deduplicate by ID to prevent showing same paper twice
        const existingIds = new Set(prev.map(r => r.id));
        const uniqueNewResults = nextResults.hits.filter(r => !existingIds.has(r.id));
        
        if (uniqueNewResults.length === 0) {
          setHasMore(false);
          return prev;
        }
        
        const newResults = [...prev, ...uniqueNewResults];
        // Update hasMore based on new total
        setHasMore(newResults.length < initialTotal);
        return newResults;
      });
      setPage(nextPage);
    } catch (error) {
      console.error('Error loading more results:', error);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, searchParams, initialTotal]);

  useEffect(() => {
    // Reset state when search parameters change
    setResults(initialResults);
    setPage(1);
    setHasMore(initialResults.length < initialTotal);
  }, [searchKey, initialResults, initialTotal]);

  useEffect(() => {
    // Setup intersection observer for infinite scroll
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      {
        threshold: 0.1,
        rootMargin: '100px',
      }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loading, loadMore]);

  return (
    <>
      <div className="space-y-4">
        {filteredResults.length > 0 ? (
          filteredResults.map((record) => (
            <ResultCard key={record.id} record={record} />
          ))
        ) : (
          <div className="text-center py-12 bg-muted/50 rounded-lg">
            <p className="text-muted-foreground">
              No free full-text PDFs available in these results.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your search or filters.
            </p>
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading more results...
          </span>
        </div>
      )}

      {/* Intersection observer target */}
      <div ref={loadMoreRef} className="h-4" />

      {/* Results counter */}
      {!loading && filteredResults.length > 0 && (
        <div className="text-center mt-8 pb-4">
          <p className="text-sm text-muted-foreground">
            {hasMore ? (
              <>Showing {filteredResults.length} papers with free PDFs ({results.length} total results fetched)</>
            ) : (
              <>All {filteredResults.length} papers with free PDFs loaded</>
            )}
          </p>
        </div>
      )}
    </>
  );
}

