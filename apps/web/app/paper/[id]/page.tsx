'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PaperHeader } from '@/components/paper/PaperHeader';
import { PaperMetadata } from '@/components/paper/PaperMetadata';
import { PaperAbstract } from '@/components/paper/PaperAbstract';
import { PaperActions } from '@/components/paper/PaperActions';
import { PaperCitations } from '@/components/paper/PaperCitations';
import { RelatedPapers } from '@/components/paper/RelatedPapers';
import { cachePaper, getCachedPaper } from '@/lib/paper-cache';
import { getPaper } from '@/lib/fetcher';
import type { Paper } from '@open-access-explorer/shared';

/**
 * The page's shape while the record loads: a type line, a title, a byline,
 * and the abstract beside the actions column — so the record lands in place.
 */
function PaperSkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading">
      <div className="space-y-4 border-b pb-8">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="h-9 w-4/5 rounded bg-muted" />
        <div className="h-9 w-3/5 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <div className="h-5 w-24 rounded bg-muted" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-muted" style={{ width: `${95 - i * 7}%` }} />
          ))}
        </div>
        <div className="h-48 rounded-lg border bg-subtle" />
      </div>
    </div>
  );
}

function PaperContent() {
  const params = useParams();
  const encodedId = params.id as string;
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Decode the URL-encoded ID
    const id = decodeURIComponent(encodedId);

    /**
     * What the results list stashed on the way here, when the visitor came that
     * way. A placeholder for the first paint and nothing more — see
     * `lib/paper-cache.ts`.
     *
     * Reset rather than left standing, because this effect also runs when the
     * id changes: without it the previous paper stays on screen while the next
     * one loads.
     */
    const placeholder = getCachedPaper(id);
    setPaper(placeholder);
    setLoading(placeholder === null);
    setError(false);

    let cancelled = false;

    /**
     * Asked on every view, placeholder or not.
     *
     * `/api/paper/:id` is the definition of the record: it enriches through the
     * same authorities the search path uses, so what ends up on screen converges
     * on the endpoint rather than on whatever a previous page happened to be
     * holding. This used to be skipped entirely on a placeholder hit, which is
     * what let a click and a shared link show different things.
     *
     * It replaces the placeholder outright rather than merging over it. A
     * client-side merge would be the divergence again in a smaller form, and the
     * one case where the endpoint currently answers with less — a record with no
     * DOI, which enrichment skips, reached by a click that carried a record
     * merged across several providers — is a gap to close in the endpoint, not
     * to paper over here.
     */
    getPaper(id)
      .then(data => {
        if (cancelled) return;
        setPaper(data);
        // So a second visit in this session starts from the better record.
        cachePaper(data);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Error fetching paper:', err);
        // A refresh that failed is not a paper that is missing. With something
        // already on screen the placeholder stands; with nothing, there is no
        // other answer to give.
        if (!placeholder) setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [encodedId]);

  if (loading) {
    return <PaperSkeleton />;
  }

  if (error || !paper) {
    return (
      <div className="py-16 text-center">
        <h3 className="mb-1 text-lg font-semibold">Paper Not Found</h3>
        <p className="text-sm text-muted-foreground">
          The paper you&rsquo;re looking for could not be found.
        </p>
      </div>
    );
  }

  return (
    <article>
      {/* Paper Header with Title and Basic Info */}
      <PaperHeader paper={paper} />

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
        {/* Main Content Area */}
        <div className="min-w-0 space-y-10">
          {/* Abstract */}
          <PaperAbstract abstract={paper.abstract} />

          {/* Citations Section */}
          {/* Compared rather than tested for truth: `0 && …` renders the 0. */}
          {paper.citationCount !== undefined && paper.citationCount > 0 && (
            <PaperCitations 
              citationCount={paper.citationCount}
              doi={paper.doi}
            />
          )}

          {/* Related topics */}
          <RelatedPapers topics={paper.topics} />
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Actions (Download, Cite, Save) */}
          <div className="rounded-lg border bg-card p-4">
            <PaperActions paper={paper} />
          </div>

          {/* Metadata */}
          <PaperMetadata paper={paper} />
        </aside>
      </div>
    </article>
  );
}

export default function PaperPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PaperContent />
    </div>
  );
}

