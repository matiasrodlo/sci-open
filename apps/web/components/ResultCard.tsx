'use client';

import { useState } from 'react';
import { Download, ExternalLink, Eye, FileText, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Paper } from '@open-access-explorer/shared';
import { accessRoute, copyLabel, copyNote, foundIn, notableStage } from '@/lib/access';
import { openExternal } from '@/lib/external-link';
import { cachePaper } from '@/lib/paper-cache';
import Link from 'next/link';

interface ResultCardProps {
  record: Paper;
}

/** Sources named on a card before the rest are counted instead. */
const SOURCES_SHOWN = 3;

export function ResultCard({ record }: ResultCardProps) {
  const [doiCopied, setDoiCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const route = accessRoute(record.oaStatus);
  const stage = notableStage(record.stage);
  const sources = foundIn(record);
  const copy = record.fullText;

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

  /**
   * Opens the copy the record names.
   *
   * This used to ask `/api/paper/:id` for the record again when the URL would
   * not open. It cannot fail to: `openExternal` refuses only what `httpUrl`
   * rejects, and a copy is built by `fullTextAt`, which keeps nothing else.
   * The error stays for a record that reached here some other way.
   */
  const handleOpenCopy = () => {
    setDownloadError(openExternal(copy?.url) ? null : 'This copy’s link could not be opened');
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

        {/* How it is open, which version it is, and who returned it: what
            the paper carries beyond the one source version 1 kept. */}
        {(route || stage || sources.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {route && (
              <span className="font-medium text-green-700 dark:text-green-400" title={route.note}>
                {route.label}
              </span>
            )}
            {stage && <span className="font-medium">{stage}</span>}
            {sources.length > 0 && (
              <span title={sources.join(', ')}>
                Found in {sources.slice(0, SOURCES_SHOWN).join(', ')}
                {sources.length > SOURCES_SHOWN && ` +${sources.length - SOURCES_SHOWN}`}
              </span>
            )}
          </div>
        )}
        
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
          
          {copy && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenCopy}
              className="h-8 text-xs hover:bg-muted"
              aria-label={`Open the ${copy.kind === 'pdf' ? 'PDF' : 'full text'} of ${record.title} in a new tab`}
              title={copyNote(copy)}
            >
              {copy.kind === 'pdf'
                ? <Download className="h-3 w-3 mr-1.5" aria-hidden="true" />
                : <FileText className="h-3 w-3 mr-1.5" aria-hidden="true" />}
              {copyLabel(copy)}
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
