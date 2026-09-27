'use client';

import { useState } from 'react';
import type { Paper } from '@open-access-explorer/shared';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, FileText, Quote, Share2, Check, Copy } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { generateBibTeX, downloadBibTeX } from '@/lib/bibtex';
import { externalHref, openExternal } from '@/lib/external-link';
import { copyNote } from '@/lib/access';

interface PaperActionsProps {
  paper: Paper;
}

/**
 * What the API said went wrong, rather than the number it said it with.
 *
 * `PDF download failed with status ${response.status}` was all this reported,
 * and the status is the least specific thing in the answer: a publisher
 * refusing a robot, a URL the record was wrong about, and a landing page
 * indexed as a PDF are three different problems, and the body names which one
 * — "Upstream returned 403 for the PDF", "Upstream served text/html, not a
 * PDF". Only the body is read; the `requestId` alongside it belongs in the
 * API's log, not in the browser console.
 *
 * The status is still the fallback, because a 502 from the proxy in front of
 * the API answers with its own shape and a gateway may answer with none at all.
 */
async function reasonFor(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error) {
      return `PDF download failed: ${body.error}`;
    }
  } catch {
    // Not JSON, or no body. The status below is what is left.
  }
  return `PDF download failed with status ${response.status}`;
}

export function PaperActions({ paper }: PaperActionsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Where the reader can fetch the copy themselves, when the proxy could not.
  const [fallbackHref, setFallbackHref] = useState<string | null>(null);
  const [citationCopied, setCitationCopied] = useState(false);

  /**
   * The copy, and whether it is a file to download.
   *
   * Every copy used to arrive as `bestPdfUrl`, so a web page — a CORE reader,
   * a DOAJ article page — was offered as "Download PDF", sent through the PDF
   * route, refused by it as "Upstream served text/html, not a PDF", and then
   * opened in a tab by the fallback below. It opens in a tab directly now.
   */
  const copy = paper.fullText;
  const isPdf = copy?.kind === 'pdf';

  const handleOpenFullText = () => {
    setDownloadError(openExternal(copy?.url) ? null : 'This copy’s link could not be opened');
  };

  const handleDownloadPDF = async () => {
    if (!copy) {
      setDownloadError('PDF not available');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    setFallbackHref(null);

    try {
      // By the paper's id: the API takes the address from its own record of
      // the paper rather than from the browser, which is what keeps the
      // download from being a fetcher for any URL a caller names.
      const response = await fetch(`/api/papers/${encodeURIComponent(paper.id)}/pdf`);

      if (!response.ok) {
        throw new Error(await reasonFor(response));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${paper.title.slice(0, 50).replace(/[^a-z0-9]/gi, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking straight after click can cancel the download before the
      // browser has read the blob, so give it a moment first.
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (error) {
      /**
       * Offered as a link rather than opened.
       *
       * The fallback used to be `window.open` on the publisher's copy, run once
       * the proxy had answered — by which point the click that started this is
       * seconds old. Browsers only let a page open a tab close to a click, so a
       * slow failure, the ordinary one, had its tab blocked; Safari blocks it
       * after any wait at all. And `noopener` makes `window.open` return null
       * whether or not the tab opened, so the page could not tell, said
       * nothing, and the reader was left with a button that did nothing. A link
       * is opened by the reader's own click, which no blocker refuses.
       */
      const href = externalHref(copy.url);
      console.warn('Proxy download failed:', error);
      setDownloadError(error instanceof Error ? error.message : 'Failed to download PDF');
      setFallbackHref(href ?? null);
    } finally {
      setIsDownloading(false);
    }
  };

  const generateCitation = () => {
    const authors = paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '');
    const year = paper.year || 'n.d.';
    const venue = paper.venue ? `, ${paper.venue}` : '';
    const doi = paper.doi ? ` DOI: ${paper.doi}` : '';
    
    return `${authors} (${year}). ${paper.title}${venue}.${doi}`;
  };

  const handleCopyCitation = () => {
    navigator.clipboard.writeText(generateCitation());
    setCitationCopied(true);
    setTimeout(() => setCitationCopied(false), 2000);
  };

  const handleExportBibTeX = () => {
    const bibtex = generateBibTeX(paper);
    const filename = `${paper.title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.bib`;
    downloadBibTeX(bibtex, filename);
  };

  const handleCopyBibTeX = () => {
    const bibtex = generateBibTeX(paper);
    navigator.clipboard.writeText(bibtex);
    setCitationCopied(true);
    setTimeout(() => setCitationCopied(false), 2000);
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({
        title: paper.title,
        text: `Check out this paper: ${paper.title}`,
        url: url,
      });
    } else {
      navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    }
  };

  return (
    <div className="space-y-4">
      {/* Download the PDF, or open a copy that is a web page */}
      {copy && !isPdf ? (
        <Button
          onClick={handleOpenFullText}
          className="w-full gap-2 font-medium"
          size="lg"
          title={copyNote(copy)}
        >
          <FileText className="h-4 w-4" />
          Read Full Text
        </Button>
      ) : (
        <Button
          onClick={handleDownloadPDF}
          disabled={!copy || isDownloading}
          className="w-full gap-2 font-medium"
          variant={copy ? "default" : "secondary"}
          size="lg"
          {...(copy ? { title: copyNote(copy) } : {})}
        >
          <Download className="h-4 w-4" />
          {isDownloading ? 'Downloading...' : copy ? 'Download PDF' : 'Full Text Not Available'}
        </Button>
      )}
      {downloadError && (
        <p className="text-xs text-destructive">
          {downloadError}
          {fallbackHref && (
            <a
              href={fallbackHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block underline text-foreground"
            >
              Open the publisher&rsquo;s copy instead
            </a>
          )}
        </p>
      )}

      {/* View Source */}
      {paper.landingPage && (
        <Button
          onClick={() => openExternal(paper.landingPage)}
          variant="outline"
          className="w-full gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          View Source
        </Button>
      )}

      {/* Citation */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <Quote className="h-4 w-4" />
            Cite
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Citation</h4>
            
            {/* Plain Text Citation */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Plain Text</p>
              <div className="bg-muted p-3 rounded text-xs leading-relaxed">
                {generateCitation()}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCopyCitation}
                className="w-full gap-2 mt-2"
              >
                {citationCopied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy Citation
                  </>
                )}
              </Button>
            </div>
            
            {/* BibTeX Export */}
            <div className="pt-3 border-t space-y-2">
              <p className="text-xs text-muted-foreground">BibTeX Format</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportBibTeX}
                  className="flex-1 gap-2"
                >
                  <Download className="h-3 w-3" />
                  Download .bib
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyBibTeX}
                  className="flex-1 gap-2"
                >
                  <Copy className="h-3 w-3" />
                  Copy BibTeX
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Share */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={handleShare}
      >
        <Share2 className="h-4 w-4" />
        Share
      </Button>
    </div>
  );
}

