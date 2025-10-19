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
  const [results, setResults] = useState<OARecord[]>(initialResults);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialResults.length < initialTotal);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    try {
      const nextPage = page + 1;
      const nextResults = await searchPapers({
        ...searchParams,
        page: nextPage,
      });

      setResults(prev => [...prev, ...nextResults.hits]);
      setPage(nextPage);
      setHasMore(results.length + nextResults.hits.length < initialTotal);
    } catch (error) {
      console.error('Error loading more results:', error);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, searchParams, results.length, initialTotal]);

  useEffect(() => {
    // Reset state when search parameters change
    setResults(initialResults);
    setPage(1);
    setHasMore(initialResults.length < initialTotal);
  }, [initialResults, initialTotal]);

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
        {results.map((record) => (
          <ResultCard key={record.id} record={record} />
        ))}
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
      {!loading && (
        <div className="text-center mt-8 pb-4">
          <p className="text-sm text-muted-foreground">
            {hasMore ? (
              <>Showing {results.length} of {initialTotal} results</>
            ) : (
              <>All {results.length} results loaded</>
            )}
          </p>
        </div>
      )}
    </>
  );
}

