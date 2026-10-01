'use client';

import { ExternalLink } from 'lucide-react';
import { openExternal } from '@/lib/external-link';

interface PaperCitationsProps {
  citationCount?: number;
  doi?: string;
}

export function PaperCitations({ citationCount, doi }: PaperCitationsProps) {
  if (!citationCount || citationCount === 0) {
    return null;
  }

  const handleViewCitations = () => {
    if (doi) {
      // Try multiple citation sources
      const sources = [
        `https://opencitations.net/index/coci/api/v1/citations/${doi}`,
        `https://scholar.google.com/scholar?q=${encodeURIComponent(doi)}`,
        `https://www.semanticscholar.org/search?q=${encodeURIComponent(doi)}`,
      ];
      openExternal(sources[1]); // Default to Google Scholar for now
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Citations</h2>
        {doi && (
          <button
            onClick={handleViewCitations}
            className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
          >
            View on Google Scholar
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      
      <div className="inline-flex items-baseline gap-2 text-sm">
        <span className="text-4xl font-bold tracking-tight">{citationCount}</span>
        <span className="text-muted-foreground">
          {citationCount === 1 ? 'citation' : 'citations'}
        </span>
      </div>
    </section>
  );
}

