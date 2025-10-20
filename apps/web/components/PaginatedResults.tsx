'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OARecord, SearchParams } from '@open-access-explorer/shared';
import { ResultCard } from './ResultCard';
import { Pagination } from './Pagination';
import { searchPapers } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface PaginatedResultsProps {
  initialResults: OARecord[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
  searchParams: SearchParams;
}

export function PaginatedResults({ 
  initialResults, 
  initialTotal, 
  initialPage,
  initialPageSize,
  searchParams 
}: PaginatedResultsProps) {
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  
  const [results, setResults] = useState<OARecord[]>(initialResults);
  const [total, setTotal] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total pages
  const totalPages = Math.ceil(total / initialPageSize);

  // Create a search key to detect when search parameters change
  const searchKey = JSON.stringify({
    q: searchParams.q,
    sort: searchParams.sort,
    filters: searchParams.filters
  });

  // Reset state when search parameters change
  useEffect(() => {
    setResults(initialResults);
    setTotal(initialTotal);
    setCurrentPage(initialPage);
    setError(null);
  }, [searchKey, initialResults, initialTotal, initialPage]);

  const refreshResults = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const newResults = await searchPapers({
        ...searchParams,
        page: currentPage,
        pageSize: initialPageSize
      });
      
      setResults(newResults.hits);
      setTotal(newResults.total);
    } catch (err) {
      setError('Failed to load results. Please try again.');
      console.error('Error refreshing results:', err);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={refreshResults} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Try Again'
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results list */}
      <div className="space-y-4">
        {results.map((record) => (
          <ResultCard key={record.id} record={record} />
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalResults={total}
        pageSize={initialPageSize}
      />

      {/* Refresh button for manual refresh */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={refreshResults}
          disabled={loading}
          className="text-sm"
        >
          {loading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Results
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
