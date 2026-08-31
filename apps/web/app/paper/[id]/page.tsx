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
import { getCachedPaper } from '@/lib/paper-cache';
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
    
    // Try to get from cache first
    const cached = getCachedPaper(id);
    if (cached) {
      setPaper(cached);
      setLoading(false);
      return;
    }

    // If not in cache, ask the API — through the fetcher, which is the only
    // place that knows where the API is.
    let cancelled = false;
    getPaper(id)
      .then(data => { if (!cancelled) setPaper(data); })
      .catch(err => {
        console.error('Error fetching paper:', err);
        if (!cancelled) setError(true);
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

