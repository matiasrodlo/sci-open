'use client';

import { useState } from 'react';
import { Download, FileText, Copy, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OARecord } from '@open-access-explorer/shared';
import { 
  generateCitation, 
  generateCitationsBatch, 
  downloadCitation, 
  getFileExtension,
  CitationFormat,
  CitationOptions 
} from '@/lib/citations';

interface EnhancedExportButtonProps {
  results: OARecord[];
  query: string;
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

export function EnhancedExportButton({ results, query }: EnhancedExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<CitationFormat>('bibtex');
  const [exportOptions, setExportOptions] = useState<Partial<CitationOptions>>({
    includeAbstract: false,
    includeKeywords: true,
    includeDOI: true,
    includeURL: true,
    maxAuthors: 20,
  });

  const handleExportAll = () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    
    const citations = generateCitationsBatch(results, options);
    const filename = `${query.replace(/[^a-zA-Z0-9]/g, '_')}_all.${getFileExtension(selectedFormat)}`;
    downloadCitation(citations, filename, selectedFormat);
    setIsOpen(false);
  };

  const handleExportFirst50 = () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    
    const citations = generateCitationsBatch(results.slice(0, 50), options);
    const filename = `${query.replace(/[^a-zA-Z0-9]/g, '_')}_first50.${getFileExtension(selectedFormat)}`;
    downloadCitation(citations, filename, selectedFormat);
    setIsOpen(false);
  };

  const handleCopyToClipboard = async () => {
    const options: CitationOptions = {
      format: selectedFormat,
      ...exportOptions,
    };
    
    const citations = generateCitationsBatch(results, options);
    
    try {
      await navigator.clipboard.writeText(citations);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = citations;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Export Citations
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Export Citations</h4>
            <p className="text-xs text-muted-foreground">
              Download references in various academic formats
            </p>
          </div>
          
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
                  className="h-8 text-xs justify-start"
                >
                  {format.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {CITATION_FORMATS.find(f => f.value === selectedFormat)?.description}
            </p>
          </div>

          {/* Export Options */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Export Options</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={exportOptions.includeAbstract || false}
                  onChange={(e) => handleOptionChange('includeAbstract', e.target.checked)}
                  className="rounded"
                />
                <span>Include abstract</span>
              </label>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={exportOptions.includeKeywords !== false}
                  onChange={(e) => handleOptionChange('includeKeywords', e.target.checked)}
                  className="rounded"
                />
                <span>Include keywords</span>
              </label>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={exportOptions.includeDOI !== false}
                  onChange={(e) => handleOptionChange('includeDOI', e.target.checked)}
                  className="rounded"
                />
                <span>Include DOI</span>
              </label>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={exportOptions.includeURL !== false}
                  onChange={(e) => handleOptionChange('includeURL', e.target.checked)}
                  className="rounded"
                />
                <span>Include URL</span>
              </label>
            </div>
          </div>
          
          {/* Export Actions */}
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
                  <Copy className="h-3.5 w-3.5" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Export citations in {selectedFormat.toUpperCase()} format for use in reference managers and academic writing.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
