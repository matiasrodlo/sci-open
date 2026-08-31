import { OARecord } from '@open-access-explorer/shared';
import { CitationOptions, downloadCitation, generateCitation } from './citations';

/** BibTeX-shaped wrappers over the citation module, for callers that only want BibTeX. */

export function generateBibTeX(record: OARecord, options?: Partial<CitationOptions>): string {
  return generateCitation(record, { format: 'bibtex', ...options });
}

export function downloadBibTeX(bibtex: string, filename: string): void {
  downloadCitation(bibtex, filename, 'bibtex');
}
