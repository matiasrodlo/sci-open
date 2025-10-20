'use client';

import { useState } from 'react';
import { OARecord } from '@open-access-explorer/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Quote, Bookmark, Share2, Check, Copy } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { generateBibTeX, downloadBibTeX } from '@/lib/bibtex';

interface PaperActionsProps {
  paper: OARecord;
}

export function PaperActions({ paper }: PaperActionsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [citationCopied, setCitationCopied] = useState(false);

  const handleDownloadPDF = async () => {
    if (!paper.bestPdfUrl) {
      setDownloadError('PDF not available');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    try {
      const response = await fetch('/api/download-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          paperId: paper.id,
          pdfUrl: paper.bestPdfUrl 
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${paper.title.slice(0, 50).replace(/[^a-z0-9]/gi, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      setDownloadError('Failed to download PDF');
      // Fallback: open in new tab
      if (paper.bestPdfUrl) {
        window.open(paper.bestPdfUrl, '_blank');
      }
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
      {/* Download PDF */}
      <Button
        onClick={handleDownloadPDF}
        disabled={!paper.bestPdfUrl || isDownloading}
        className="w-full gap-2 font-medium"
        variant={paper.bestPdfUrl ? "default" : "secondary"}
        size="lg"
      >
        <Download className="h-4 w-4" />
        {isDownloading ? 'Downloading...' : paper.bestPdfUrl ? 'Download PDF' : 'PDF Not Available'}
      </Button>
      {downloadError && (
        <p className="text-xs text-destructive">{downloadError}</p>
      )}

      {/* View Source */}
      {paper.landingPage && (
        <Button
          onClick={() => window.open(paper.landingPage, '_blank')}
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

