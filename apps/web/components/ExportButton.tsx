'use client';

import { useState } from 'react';
import { Download, Check, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OARecord } from '@open-access-explorer/shared';
import { generateBibTeX, generateBibTeXBatch, downloadBibTeX } from '@/lib/bibtex';

interface ExportButtonProps {
  results: OARecord[];
  query: string;
}

export function ExportButton({ results, query }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExportAll = () => {
    const bibtex = generateBibTeXBatch(results);
    const filename = `${query.replace(/[^a-zA-Z0-9]/g, '_')}_references.bib`;
    downloadBibTeX(bibtex, filename);
    setIsOpen(false);
  };

  const handleCopyToClipboard = () => {
    const bibtex = generateBibTeXBatch(results);
    navigator.clipboard.writeText(bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportFirst50 = () => {
    const bibtex = generateBibTeXBatch(results.slice(0, 50));
    const filename = `${query.replace(/[^a-zA-Z0-9]/g, '_')}_first50.bib`;
    downloadBibTeX(bibtex, filename);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Export BibTeX
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Export Citations</h4>
            <p className="text-xs text-muted-foreground">
              Download references in BibTeX format
            </p>
          </div>
          
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportAll}
              className="w-full justify-start gap-2"
            >
              <FileText className="h-3.5 w-3.5" />
              Export All ({results.length})
            </Button>
            
            {results.length > 50 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportFirst50}
                className="w-full justify-start gap-2"
              >
                <FileText className="h-3.5 w-3.5" />
                Export First 50
              </Button>
            )}
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyToClipboard}
              className="w-full justify-start gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            BibTeX format is compatible with LaTeX, Reference Manager, and other citation tools.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

