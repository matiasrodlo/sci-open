import { OARecord } from '@open-access-explorer/shared';
import { generateCitation, CitationOptions } from './citations';

/**
 * Generate BibTeX entry for a single record (enhanced version)
 */
export function generateBibTeX(record: OARecord, options?: Partial<CitationOptions>): string {
  const citationOptions: CitationOptions = {
    format: 'bibtex',
    includeAbstract: true,
    includeKeywords: true,
    includeDOI: true,
    includeURL: true,
    maxAuthors: 20,
    ...options
  };
  
  return generateCitation(record, citationOptions);
}

/**
 * Generate BibTeX for multiple records
 */
export function generateBibTeXBatch(records: OARecord[], options?: Partial<CitationOptions>): string {
  return records.map(record => generateBibTeX(record, options)).join('\n\n');
}

/**
 * Download BibTeX file
 */
export function downloadBibTeX(bibtex: string, filename: string): void {
  const blob = new Blob([bibtex], { type: 'application/x-bibtex' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}


