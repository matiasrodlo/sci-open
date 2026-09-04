'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PaperHeader } from '@/components/paper/PaperHeader';
import { PaperMetadata } from '@/components/paper/PaperMetadata';
import { PaperAbstract } from '@/components/paper/PaperAbstract';
import { PaperActions } from '@/components/paper/PaperActions';
import { PaperCitations } from '@/components/paper/PaperCitations';
import { RelatedPapers } from '@/components/paper/RelatedPapers';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { cachePaper, getCachedPaper } from '@/lib/paper-cache';
import { getPaper } from '@/lib/fetcher';
import { OARecord } from '@open-access-explorer/shared';

function PaperContent() {
  const params = useParams();
  const encodedId = params.id as string;
  const [paper, setPaper] = useState<OARecord | null>(null);
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
    return <LoadingSkeleton />;
  }

  if (error || !paper) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-semibold mb-2">Paper Not Found</h3>
        <p className="text-muted-foreground">
          The paper you&rsquo;re looking for could not be found.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Paper Header with Title and Basic Info */}
      <PaperHeader paper={paper} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-12 mt-8">
        {/* Main Content Area (3 columns) */}
        <div className="lg:col-span-3">
          {/* Abstract */}
          <PaperAbstract abstract={paper.abstract} />

          {/* Citations Section */}
          {paper.citationCount && paper.citationCount > 0 && (
            <PaperCitations 
              citationCount={paper.citationCount}
              doi={paper.doi}
            />
          )}

          {/* Related topics */}
          <RelatedPapers topics={paper.topics} />
        </div>

        {/* Sidebar (1 column) */}
        <div className="lg:col-span-1 space-y-8">
          {/* Actions (Download, Cite, Save) */}
          <PaperActions paper={paper} />

          {/* Metadata */}
          <PaperMetadata paper={paper} />
        </div>
      </div>
    </div>
  );
}

export default function PaperPage() {
  return (
    <div className="container mx-auto px-6 py-12">
      <PaperContent />
    </div>
  );
}

