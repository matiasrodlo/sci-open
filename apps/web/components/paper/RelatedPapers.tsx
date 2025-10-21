'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Network, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { OARecord } from '@open-access-explorer/shared';

interface RelatedPapersProps {
  topics?: string[];
  currentPaperId: string;
}

export function RelatedPapers({ topics, currentPaperId }: RelatedPapersProps) {
  const [relatedPapers, setRelatedPapers] = useState<OARecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRelatedPapers() {
      if (!topics || topics.length === 0) {
        setLoading(false);
        return;
      }

      try {
        // Create a more comprehensive search query using multiple topics
        const searchQuery = topics.length > 1 
          ? topics.slice(0, 3).join(' OR ') 
          : topics[0];
        
        const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
        const response = await fetch(`${apiBase}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: searchQuery,
            page: 1,
            pageSize: 8, // Get more results to have better filtering
            sort: 'relevance'
          }),
        });

        if (response.ok) {
          const data = await response.json();
          // Filter out the current paper and ensure we have valid results
          const filtered = data.hits
            .filter((p: OARecord) => p.id !== currentPaperId && p.title && p.title.trim() !== '')
            .slice(0, 4);
          setRelatedPapers(filtered);
        } else {
          console.warn('Failed to fetch related papers:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Error fetching related papers:', error);
        // Don't show error to user, just silently fail
      } finally {
        setLoading(false);
      }
    }

    fetchRelatedPapers();
  }, [topics, currentPaperId]);

  if (loading) {
    return (
      <div className="border-t pt-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">Related Papers</h2>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (relatedPapers.length === 0) {
    return (
      <div className="border-t pt-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">Related Papers</h2>
        <p className="text-sm text-muted-foreground">
          No related papers found for this topic.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t pt-6 mt-6">
      <h2 className="text-lg font-semibold mb-4">Related Papers</h2>
      <div className="space-y-4">
        {relatedPapers.map((paper) => (
          <Link 
            key={paper.id}
            href={`/paper/${encodeURIComponent(paper.id)}`}
            className="block group"
          >
            <div className="space-y-2">
              <h4 className="text-sm font-medium leading-tight group-hover:text-primary transition-colors line-clamp-2">
                {paper.title}
              </h4>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {paper.authors && paper.authors.length > 0 ? (
                    <>
                      {paper.authors.slice(0, 2).join('; ')}
                      {paper.authors.length > 2 && ' et al.'}
                    </>
                  ) : (
                    'Unknown authors'
                  )}
                </span>
                {paper.year && <span className="font-medium">({paper.year})</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

