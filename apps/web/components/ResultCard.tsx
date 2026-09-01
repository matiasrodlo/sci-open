'use client';

import { useState } from 'react';
import { Download, ExternalLink, Eye, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OARecord } from '@open-access-explorer/shared';
import { getPaper } from '@/lib/fetcher';
import { openExternal } from '@/lib/external-link';
import { cachePaper } from '@/lib/paper-cache';
import Link from 'next/link';

interface ResultCardProps {
  record: OARecord;
}

export function ResultCard({ record }: ResultCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [doiCopied, setDoiCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Cache paper data for detail page
  const handlePaperClick = () => {
    cachePaper(record);
  };

  const handleCopyDOI = async () => {
    if (record.doi) {
      try {
        await navigator.clipboard.writeText(record.doi);
        setDoiCopied(true);
        setTimeout(() => setDoiCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy DOI:', error);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = record.doi;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setDoiCopied(true);
        setTimeout(() => setDoiCopied(false), 2000);
      }
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    
    try {
      // If we already have a PDF URL, use it directly
      if (record.bestPdfUrl && openExternal(record.bestPdfUrl)) {
        setIsDownloading(false);
        return;
      }
      
      // Otherwise, try to resolve it via the API. The endpoint returns the
      // record itself — this read `response.pdf.url`, which the typed fetcher
      // promised and the endpoint has never sent, so every record without a
      // `bestPdfUrl` threw a TypeError here instead of reporting no PDF.
      const resolved = await getPaper(record.id);
      const url = resolved.bestPdfUrl;
      if (!openExternal(url)) {
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
        {/* Title */}
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
              <Quote className="h-3 w-3" aria-hidden="true" />
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
          <p className="text-xs text-destructive" role="alert">{downloadError}</p>
        )}
        
        {/* Actions */}
        <div className="flex items-center gap-3 pt-2" role="group" aria-label={`Actions for ${record.title}`}>
          <Link href={`/paper/${encodeURIComponent(record.id)}`} onClick={handlePaperClick}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs hover:bg-muted"
              aria-label={`Details for ${record.title}`}
            >
              <Eye className="h-3 w-3 mr-1.5" aria-hidden="true" />
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
              aria-label={`Download PDF of ${record.title}`}
            >
              <Download className="h-3 w-3 mr-1.5" aria-hidden="true" />
              {isDownloading ? 'Downloading...' : 'PDF'}
            </Button>
          )}
          
          {record.landingPage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openExternal(record.landingPage)}
              className="h-8 text-xs hover:bg-muted"
              aria-label={`Open the publisher page for ${record.title} in a new tab`}
            >
              <ExternalLink className="h-3 w-3 mr-1.5" aria-hidden="true" />
              Source
            </Button>
          )}
          
          {record.doi && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyDOI}
              className="h-8 text-xs hover:bg-muted font-mono"
              aria-label={`Copy the DOI of ${record.title}`}
              title={doiCopied ? 'DOI copied to clipboard!' : 'Click to copy DOI'}
            >
              <span aria-live="polite">{doiCopied ? 'Copied!' : 'DOI'}</span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
