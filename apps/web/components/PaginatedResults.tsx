'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OARecord } from '@open-access-explorer/shared';
import { ResultCard } from './ResultCard';
import { Pagination } from './Pagination';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

/**
 * The results list, its pagination, and the control that runs the search again.
 *
 * **The retry is `router.refresh()`, not a second fetch.** It used to re-post
 * the search from the browser and write the answer into local state, which was
 * wrong twice over.
 *
 * It could not refresh anything. The API answered the identical request from
 * `searchCacheManager` for the next five minutes, so the button returned the
 * bytes it already had — and the case a reader actually wants to retry, a
 * search reported incomplete because a provider timed out, was precisely the
 * case that had been cached. The API no longer stores a `complete: false`
 * result, which is what makes a retry able to reach the providers that failed.
 *
 * And it refreshed a third of the page. `hits` and `total` live here, but the
 * facet panel, the per-provider coverage and the incompleteness warning are all
 * rendered by the server component from the same response — so a "refreshed"
 * page showed new results beside counts belonging to the previous answer.
 * Asking the server to render again updates all of it from one response, which
 * is the only way those numbers can agree.
 *
 * What is left is a component with no state of its own. The `useState` mirrors
 * of `initialResults`, `initialTotal` and `initialPage`, and the `useEffect`
 * that copied props back over them whenever the query changed, existed only to
 * let the old refresh write somewhere. Rendering the props directly cannot go
 * stale, and drops the effect that syncing invited.
 */

interface PaginatedResultsProps {
  results: OARecord[];
  total: number;
  page: number;
  pageSize: number;
}

export function PaginatedResults({ results, total, page, pageSize }: PaginatedResultsProps) {
  const router = useRouter();
  // `useTransition` rather than a `loading` flag: the pending state belongs to
  // the server render this starts, so React owns when it ends. A hand-rolled
  // flag has to guess, and the old one guessed wrong on an error — it cleared
  // in `finally` while the error banner it had just set stayed up.
  const [refreshing, startRefresh] = useTransition();

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {results.map(record => (
          <ResultCard key={record.id} record={record} />
        ))}
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalResults={total}
        pageSize={pageSize}
      />

      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="text-sm"
          // A search that answered completely is answered the same way again,
          // and that is the correct outcome rather than a broken one. The
          // control is worth having for the search that did not.
          title="Run this search again, asking any source that did not answer"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Searching…' : 'Refresh results'}
        </Button>
      </div>
    </div>
  );
}
