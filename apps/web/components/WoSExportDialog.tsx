'use client';

import { useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
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

/**
 * Exports the records on this page.
 *
 * It used to offer three scopes and honour one. "All records" was labelled
 * with `Math.min(1000, totalResults)` and returned `results` — the current
 * page, twenty records — and the numeric range sliced the same twenty by
 * indices the label described as running to 1,000. A reader asking for records
 * 500 to 600 of a 4,000-result search got an empty file and no explanation.
 *
 * The page is what the client holds, so the page is what is offered, and the
 * labels say so. Exporting beyond it is not a display fix: the export would
 * have to re-request the search at a larger page size, and the orchestrator
 * enriches whatever page it returns — 1,000 records would be some 3,000
 * authority lookups on a button press. Doing it properly needs a way to ask
 * for a page without enrichment, which is a backend change and not this one.
 */

const FORMATS: Array<{ value: CitationFormat; label: string; description: string }> = [
  { value: 'bibtex', label: 'BibTeX', description: 'LaTeX and most reference managers' },
  { value: 'ris', label: 'RIS', description: 'EndNote, Zotero, Mendeley' }
];

export function WoSExportDialog({ results, query, currentPage }: WoSExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<CitationFormat>('bibtex');
  const [useRange, setUseRange] = useState(false);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(results.length);
  const [includeAbstract, setIncludeAbstract] = useState(true);
  const [includeKeywords, setIncludeKeywords] = useState(true);

  const clamp = (value: number) => Math.min(Math.max(value, 1), results.length);

  const selected = useRange
    ? results.slice(clamp(start) - 1, clamp(Math.max(end, start)))
    : results;

  const options = (): CitationOptions => ({
    format,
    includeAbstract,
    includeKeywords,
    includeDOI: true,
    includeURL: true,
    maxAuthors: 20
  });

  const filename = () => {
    const base = query
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
      .slice(0, 30) || 'export';
    const scope = useRange ? `records_${clamp(start)}_to_${clamp(Math.max(end, start))}` : `page_${currentPage}`;
    return `${base}_${scope}_${selected.length}_records.${getFileExtension(format)}`;
  };

  const handleExport = () => {
    downloadCitation(generateCitationsBatch(selected, options()), filename(), format);
    setIsOpen(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generateCitationsBatch(selected, options()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end" aria-label="Export citations">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Export citations</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The {results.length} records on page {currentPage}. To export others, page to them first.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-2">Records</legend>

            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="scope-page"
                name="scope"
                checked={!useRange}
                onChange={() => setUseRange(false)}
              />
              <label htmlFor="scope-page" className="text-sm">
                All {results.length} on this page
              </label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="scope-range"
                name="scope"
                checked={useRange}
                onChange={() => setUseRange(true)}
              />
              <label htmlFor="scope-range" className="text-sm">
                A range within this page
              </label>
            </div>

            {useRange && (
              <div className="ml-6 flex items-center space-x-2">
                <label htmlFor="range-start" className="sr-only">First record</label>
                <input
                  id="range-start"
                  type="number"
                  min={1}
                  max={results.length}
                  value={start}
                  onChange={e => setStart(parseInt(e.target.value) || 1)}
                  className="w-16 px-2 py-1 text-xs border rounded"
                />
                <span className="text-sm">to</span>
                <label htmlFor="range-end" className="sr-only">Last record</label>
                <input
                  id="range-end"
                  type="number"
                  min={1}
                  max={results.length}
                  value={end}
                  onChange={e => setEnd(parseInt(e.target.value) || results.length)}
                  className="w-16 px-2 py-1 text-xs border rounded"
                />
                <span className="text-xs text-muted-foreground">of {results.length}</span>
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="export-format" className="text-sm font-medium">
              Format
            </label>
            <select
              id="export-format"
              value={format}
              onChange={e => setFormat(e.target.value as CitationFormat)}
              className="w-full px-3 py-2 text-sm border rounded bg-background"
            >
              {FORMATS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.description}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-2">Include</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeAbstract}
                  onChange={e => setIncludeAbstract(e.target.checked)}
                />
                <span>Abstract</span>
              </label>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeKeywords}
                  onChange={e => setIncludeKeywords(e.target.checked)}
                />
                <span>Keywords</span>
              </label>
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button onClick={handleExport} className="flex-1 gap-2" size="sm" disabled={selected.length === 0}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export {selected.length}
            </Button>

            <Button variant="outline" onClick={handleCopy} className="flex-1 gap-2" size="sm" disabled={selected.length === 0}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
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
