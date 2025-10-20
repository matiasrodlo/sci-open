'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Quote, TrendingUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      window.open(sources[1], '_blank'); // Default to Google Scholar for now
    }
  };

  return (
    <div className="border-t pt-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Citations</h2>
        {doi && (
          <button
            onClick={handleViewCitations}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            View on Google Scholar
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      
      <div className="inline-flex items-center gap-2 text-sm">
        <span className="text-2xl font-semibold">{citationCount}</span>
        <span className="text-muted-foreground">
          {citationCount === 1 ? 'citation' : 'citations'}
        </span>
      </div>
    </div>
  );
}

