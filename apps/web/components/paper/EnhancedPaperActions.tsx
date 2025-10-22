'use client';

import { useState } from 'react';
import { Download, Quote, Copy, Check, ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OARecord } from '@open-access-explorer/shared';
import { 
  generateCitation, 
  downloadCitation, 
  getFileExtension,
  CitationFormat,
  CitationOptions 
} from '@/lib/citations';

interface EnhancedPaperActionsProps {
  paper: OARecord;
}

const CITATION_FORMATS: { value: CitationFormat; label: string; description: string }[] = [
  { value: 'bibtex', label: 'BibTeX', description: 'LaTeX bibliography format' },
  { value: 'endnote', label: 'EndNote', description: 'EndNote reference format' },
  { value: 'ris', label: 'RIS', description: 'Research Information Systems' },
  { value: 'wos', label: 'Web of Science', description: 'WoS export format' },
  { value: 'apa', label: 'APA Style', description: 'American Psychological Association' },
  { value: 'mla', label: 'MLA Style', description: 'Modern Language Association' },
  { value: 'chicago', label: 'Chicago Style', description: 'Chicago Manual of Style' },
  { value: 'harvard', label: 'Harvard Style', description: 'Harvard referencing' },
  { value: 'vancouver', label: 'Vancouver Style', description: 'Medical journal format' },
  { value: 'plain', label: 'Plain Text', description: 'Simple text format' },
];

export function EnhancedPaperActions({ paper }: EnhancedPaperActionsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [citationCopied, setCitationCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<CitationFormat>('apa');
  const [exportOptions, setExportOptions] = useState<Partial<CitationOptions>>({
    includeAbstract: false,
    includeKeywords: true,
    includeDOI: true,
    includeURL: true,
    maxAuthors: 20,
  });

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

  const handleCopyCitation = async () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    
    const citation = generateCitation(paper, options);
    
    try {
      await navigator.clipboard.writeText(citation);
      setCitationCopied(true);
      setTimeout(() => setCitationCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy citation:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = citation;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCitationCopied(true);
      setTimeout(() => setCitationCopied(false), 2000);
    }
  };

  const handleDownloadCitation = () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    
    const citation = generateCitation(paper, options);
    const filename = `${paper.title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.${getFileExtension(selectedFormat)}`;
    downloadCitation(citation, filename, selectedFormat);
  };

  const handleFormatChange = (format: CitationFormat) => {
    setSelectedFormat(format);
  };

  const handleOptionChange = (option: keyof CitationOptions, value: any) => {
    setExportOptions(prev => ({
      ...prev,
      [option]: value,
    }));
  };

  const getCurrentCitation = () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    return generateCitation(paper, options);
  };

  return (
    <div className="space-y-4">
      {/* Download PDF */}
      {paper.bestPdfUrl && (
        <div className="space-y-2">
          <Button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="w-full gap-2"
            variant="default"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Downloading...' : 'Download PDF'}
          </Button>
          {downloadError && (
            <p className="text-sm text-red-600">{downloadError}</p>
          )}
        </div>
      )}

      {/* Enhanced Citation */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <Quote className="h-4 w-4" />
            Cite
            <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96" align="start">
          <div className="space-y-4">
            <h4 className="font-semibold text-sm">Citation</h4>
            
            {/* Format Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Citation Format</label>
              <div className="grid grid-cols-2 gap-1">
                {CITATION_FORMATS.map((format) => (
                  <Button
                    key={format.value}
                    variant={selectedFormat === format.value ? "default" : "ghost"}
                    size="sm"
                    onClick={() => handleFormatChange(format.value)}
                    className="h-7 text-xs justify-start"
                  >
                    {format.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Export Options */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Options</label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeAbstract || false}
                    onChange={(e) => handleOptionChange('includeAbstract', e.target.checked)}
                    className="rounded"
                  />
                  <span>Abstract</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeKeywords !== false}
                    onChange={(e) => handleOptionChange('includeKeywords', e.target.checked)}
                    className="rounded"
                  />
                  <span>Keywords</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeDOI !== false}
                    onChange={(e) => handleOptionChange('includeDOI', e.target.checked)}
                    className="rounded"
                  />
                  <span>DOI</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeURL !== false}
                    onChange={(e) => handleOptionChange('includeURL', e.target.checked)}
                    className="rounded"
                  />
                  <span>URL</span>
                </label>
              </div>
            </div>
            
            {/* Citation Preview */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                {CITATION_FORMATS.find(f => f.value === selectedFormat)?.label} Format
              </p>
              <div className="bg-muted p-3 rounded text-xs leading-relaxed max-h-32 overflow-y-auto">
                {getCurrentCitation()}
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCopyCitation}
                className="flex-1 gap-2"
              >
                {citationCopied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
              
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadCitation}
                className="flex-1 gap-2"
              >
                <FileText className="h-3 w-3" />
                Download
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
