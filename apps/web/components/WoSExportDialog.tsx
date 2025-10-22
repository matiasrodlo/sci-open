'use client';

import { useState } from 'react';
import { Download, FileText, Copy, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OARecord } from '@open-access-explorer/shared';
import { 
  generateCitationsBatch, 
  downloadCitation, 
  getFileExtension,
  CitationFormat,
  CitationOptions 
} from '@/lib/citations';

interface WoSExportDialogProps {
  results: OARecord[];
  query: string;
  totalResults: number;
  currentPage: number;
  pageSize: number;
}

type ExportScope = 'all' | 'page' | 'range';
type RecordContent = 'basic' | 'full';

interface ExportSettings {
  scope: ExportScope;
  startRecord: number;
  endRecord: number;
  content: RecordContent;
  format: CitationFormat;
  includeAbstract: boolean;
  includeKeywords: boolean;
  includeDOI: boolean;
  includeURL: boolean;
  includeReferences: boolean;
}

export function WoSExportDialog({ results, query, totalResults, currentPage, pageSize }: WoSExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<ExportSettings>({
    scope: 'page',
    startRecord: 1,
    endRecord: Math.min(1000, results.length),
    content: 'full',
    format: 'bibtex',
    includeAbstract: true,
    includeKeywords: true,
    includeDOI: true,
    includeURL: true,
    includeReferences: false,
  });

  const getRecordsToExport = (): OARecord[] => {
    switch (settings.scope) {
      case 'all':
        return results;
      case 'page':
        return results;
      case 'range':
        const start = Math.max(0, settings.startRecord - 1);
        const end = Math.min(results.length, settings.endRecord);
        return results.slice(start, end);
      default:
        return results;
    }
  };

  const getRecordCount = (): number => {
    return getRecordsToExport().length;
  };

  const getMaxRecords = (): number => {
    switch (settings.scope) {
      case 'all':
        return Math.min(1000, totalResults);
      case 'page':
        return results.length;
      case 'range':
        return Math.min(1000, totalResults);
      default:
        return results.length;
    }
  };

  const handleExport = () => {
    const recordsToExport = getRecordsToExport();
    
    const options: CitationOptions = {
      format: settings.format,
      includeAbstract: settings.content === 'full' && settings.includeAbstract,
      includeKeywords: settings.content === 'full' && settings.includeKeywords,
      includeDOI: settings.includeDOI,
      includeURL: settings.includeURL,
      maxAuthors: 20,
    };
    
    const citations = generateCitationsBatch(recordsToExport, options);
    const filename = generateFilename();
    downloadCitation(citations, filename, settings.format);
    setIsOpen(false);
  };

  const handleCopyToClipboard = async () => {
    const recordsToExport = getRecordsToExport();
    
    const options: CitationOptions = {
      format: settings.format,
      includeAbstract: settings.content === 'full' && settings.includeAbstract,
      includeKeywords: settings.content === 'full' && settings.includeKeywords,
      includeDOI: settings.includeDOI,
      includeURL: settings.includeURL,
      maxAuthors: 20,
    };
    
    const citations = generateCitationsBatch(recordsToExport, options);
    
    try {
      await navigator.clipboard.writeText(citations);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const generateFilename = (): string => {
    // Create a clean base name from the query
    const baseName = query
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .toLowerCase()
      .slice(0, 30) || 'export'; // Limit length
    
    const format = getFileExtension(settings.format);
    const formatName = formatOptions.find(f => f.value === settings.format)?.label.toLowerCase().replace(/\s+/g, '_') || 'export';
    
    // Generate descriptive filename based on user preferences
    let filename = '';
    
    if (settings.scope === 'all') {
      filename = `${baseName}_all_records_${formatName}`;
    } else if (settings.scope === 'page') {
      filename = `${baseName}_page_${currentPage}_${formatName}`;
    } else if (settings.scope === 'range') {
      filename = `${baseName}_records_${settings.startRecord}_to_${settings.endRecord}_${formatName}`;
    } else {
      filename = `${baseName}_${formatName}`;
    }
    
    // Add content type indicator if not full record
    if (settings.content === 'basic') {
      filename += '_basic';
    }
    
    // Add record count for clarity
    const count = getRecordCount();
    if (count > 1) {
      filename += `_${count}_records`;
    }
    
    return `${filename}.${format}`;
  };

  const updateSettings = (updates: Partial<ExportSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

  const formatOptions = [
    { value: 'bibtex' as CitationFormat, label: 'BibTeX', description: 'LaTeX bibliography format' },
    { value: 'endnote' as CitationFormat, label: 'EndNote', description: 'EndNote reference format' },
    { value: 'ris' as CitationFormat, label: 'RIS', description: 'Research Information Systems' },
    { value: 'wos' as CitationFormat, label: 'Web of Science', description: 'WoS export format' },
    { value: 'apa' as CitationFormat, label: 'APA Style', description: 'American Psychological Association' },
    { value: 'mla' as CitationFormat, label: 'MLA Style', description: 'Modern Language Association' },
    { value: 'chicago' as CitationFormat, label: 'Chicago Style', description: 'Chicago Manual of Style' },
    { value: 'harvard' as CitationFormat, label: 'Harvard Style', description: 'Harvard referencing' },
    { value: 'vancouver' as CitationFormat, label: 'Vancouver Style', description: 'Medical journal format' },
    { value: 'plain' as CitationFormat, label: 'Plain Text', description: 'Simple text format' },
  ];

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-6 w-6 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          
          {/* Record Options */}
          <div className="space-y-3">
            <h5 className="text-sm font-medium">Record Options</h5>
            
            {/* Export Scope */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="scope-page"
                  name="scope"
                  checked={settings.scope === 'page'}
                  onChange={() => updateSettings({ scope: 'page' })}
                  className="rounded"
                />
                <label htmlFor="scope-page" className="text-sm">
                  All records on page ({results.length} records)
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="scope-all"
                  name="scope"
                  checked={settings.scope === 'all'}
                  onChange={() => updateSettings({ scope: 'all' })}
                  className="rounded"
                />
                <label htmlFor="scope-all" className="text-sm">
                  All records ({Math.min(1000, totalResults)} records)
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="scope-range"
                  name="scope"
                  checked={settings.scope === 'range'}
                  onChange={() => updateSettings({ scope: 'range' })}
                  className="rounded"
                />
                <label htmlFor="scope-range" className="text-sm">
                  Records from:
                </label>
              </div>
              
              {settings.scope === 'range' && (
                <div className="ml-6 flex items-center space-x-2">
                  <input
                    type="number"
                    min="1"
                    max={totalResults}
                    value={settings.startRecord}
                    onChange={(e) => updateSettings({ startRecord: parseInt(e.target.value) || 1 })}
                    className="w-16 px-2 py-1 text-xs border rounded"
                  />
                  <span className="text-sm">to</span>
                  <input
                    type="number"
                    min={settings.startRecord}
                    max={Math.min(1000, totalResults)}
                    value={settings.endRecord}
                    onChange={(e) => updateSettings({ endRecord: parseInt(e.target.value) || settings.startRecord })}
                    className="w-16 px-2 py-1 text-xs border rounded"
                  />
                  <span className="text-xs text-muted-foreground">
                    (No more than 1000 records at a time)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Record Content */}
          <div className="space-y-3">
            <h5 className="text-sm font-medium">Record Content:</h5>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="content-basic"
                  name="content"
                  checked={settings.content === 'basic'}
                  onChange={() => updateSettings({ content: 'basic' })}
                  className="rounded"
                />
                <label htmlFor="content-basic" className="text-sm">
                  Author, Title, Source
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="content-full"
                  name="content"
                  checked={settings.content === 'full'}
                  onChange={() => updateSettings({ content: 'full' })}
                  className="rounded"
                />
                <label htmlFor="content-full" className="text-sm">
                  Full Record and Cited References
                </label>
              </div>
            </div>
          </div>

          {/* Format Selection */}
          <div className="space-y-2">
            <h5 className="text-sm font-medium">Export Format:</h5>
            <select
              value={settings.format}
              onChange={(e) => updateSettings({ format: e.target.value as CitationFormat })}
              className="w-full px-3 py-2 text-sm border rounded"
            >
              {formatOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.description}
                </option>
              ))}
            </select>
          </div>

          {/* Additional Options for Full Records */}
          {settings.content === 'full' && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">Additional Fields:</h5>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.includeAbstract}
                    onChange={(e) => updateSettings({ includeAbstract: e.target.checked })}
                    className="rounded"
                  />
                  <span>Abstract</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.includeKeywords}
                    onChange={(e) => updateSettings({ includeKeywords: e.target.checked })}
                    className="rounded"
                  />
                  <span>Keywords</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.includeDOI}
                    onChange={(e) => updateSettings({ includeDOI: e.target.checked })}
                    className="rounded"
                  />
                  <span>DOI</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.includeURL}
                    onChange={(e) => updateSettings({ includeURL: e.target.checked })}
                    className="rounded"
                  />
                  <span>URL</span>
                </label>
              </div>
            </div>
          )}

          
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleExport}
              className="flex-1 gap-2"
              size="sm"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            
            <Button
              variant="outline"
              onClick={handleCopyToClipboard}
              className="flex-1 gap-2"
              size="sm"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
