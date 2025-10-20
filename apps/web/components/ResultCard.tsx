'use client';

import { useState } from 'react';
import { Download, ExternalLink, Eye, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OARecord } from '@open-access-explorer/shared';
import { getPaper } from '@/lib/fetcher';
import { cachePaper } from '@/lib/paper-cache';
import Link from 'next/link';

interface ResultCardProps {
  record: OARecord;
}

export function ResultCard({ record }: ResultCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Cache paper data for detail page
  const handlePaperClick = () => {
    cachePaper(record);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    
    try {
      // If we already have a PDF URL, use it directly
      if (record.bestPdfUrl) {
        window.open(record.bestPdfUrl, '_blank');
        setIsDownloading(false);
        return;
      }
      
      // Otherwise, try to resolve it via the API
      const response = await getPaper(record.id);
      if (response.pdf.url) {
        window.open(response.pdf.url, '_blank');
      } else {
        setDownloadError('PDF not available');
      }
    } catch (error) {
      console.error('PDF download error:', error);
      setDownloadError('Failed to fetch PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <article className="group py-6 border-b last:border-b-0">
      <div className="space-y-3">
        {/* Title and Source Badge */}
        <div className="flex items-start justify-between gap-4">
          <Link 
            href={`/paper/${encodeURIComponent(record.id)}`} 
            onClick={handlePaperClick} 
            className="flex-1"
          >
            <h3 className="text-base font-semibold leading-tight group-hover:text-primary transition-colors cursor-pointer">
              {record.title}
            </h3>
          </Link>
          <Badge variant="outline" className="text-xs shrink-0 capitalize">
            {record.source}
          </Badge>
        </div>
        
        {/* Authors */}
        {record.authors && record.authors.length > 0 && (
          <div className="text-sm text-foreground">
            {record.authors.slice(0, 3).join('; ')}
            {record.authors.length > 3 && (
              <span className="text-muted-foreground"> et al.</span>
            )}
          </div>
        )}
        
        {/* Venue, Year, and Citations */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {record.venue && (
            <span className="italic">{record.venue}</span>
          )}
          {record.year && (
            <span>({record.year})</span>
          )}
          {record.citationCount !== undefined && record.citationCount > 0 && (
            <div className="flex items-center gap-1">
              <Quote className="h-3 w-3" />
              <span>{record.citationCount.toLocaleString()}</span>
            </div>
          )}
          {record.doi && (
            <span className="font-mono text-xs">DOI</span>
          )}
        </div>
        
        {/* Abstract */}
        {record.abstract && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {record.abstract}
          </p>
        )}
        
        {/* Topics */}
        {record.topics && record.topics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {record.topics.slice(0, 4).map((topic, index) => (
              <span
                key={index}
                className="text-xs px-2 py-1 bg-muted/50 text-muted-foreground rounded"
              >
                {topic}
              </span>
            ))}
            {record.topics.length > 4 && (
              <span className="text-xs px-2 py-1 text-muted-foreground">
                +{record.topics.length - 4}
              </span>
            )}
          </div>
        )}
        
        {/* Error Message */}
        {downloadError && (
          <p className="text-xs text-destructive">{downloadError}</p>
        )}
        
        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Link href={`/paper/${encodeURIComponent(record.id)}`} onClick={handlePaperClick}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs hover:bg-muted"
            >
              <Eye className="h-3 w-3 mr-1.5" />
              Details
            </Button>
          </Link>
          
          {record.bestPdfUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="h-8 text-xs hover:bg-muted"
            >
              <Download className="h-3 w-3 mr-1.5" />
              {isDownloading ? 'Downloading...' : 'PDF'}
            </Button>
          )}
          
          {record.landingPage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(record.landingPage, '_blank')}
              className="h-8 text-xs hover:bg-muted"
            >
              <ExternalLink className="h-3 w-3 mr-1.5" />
              Source
            </Button>
          )}
          
          {record.doi && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(`https://doi.org/${record.doi}`, '_blank')}
              className="h-8 text-xs hover:bg-muted font-mono"
            >
              DOI
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
