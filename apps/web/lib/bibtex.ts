import { OARecord } from '@open-access-explorer/shared';

/**
 * Generate BibTeX entry for a single record
 */
export function generateBibTeX(record: OARecord): string {
  // Determine entry type based on venue or source
  const entryType = determineEntryType(record);
  
  // Generate citation key (Author_Year_FirstWord)
  const citationKey = generateCitationKey(record);
  
  // Build BibTeX fields
  const fields: string[] = [];
  
  // Title (required for all types)
  if (record.title) {
    fields.push(`  title = {${escapeBibTeX(record.title)}}`);
  }
  
  // Authors
  if (record.authors && record.authors.length > 0) {
    fields.push(`  author = {${record.authors.join(' and ')}}`);
  }
  
  // Year
  if (record.year) {
    fields.push(`  year = {${record.year}}`);
  }
  
  // Journal/Venue (for articles)
  if (record.venue && (entryType === 'article' || entryType === 'inproceedings')) {
    if (entryType === 'article') {
      fields.push(`  journal = {${escapeBibTeX(record.venue)}}`);
    } else {
      fields.push(`  booktitle = {${escapeBibTeX(record.venue)}}`);
    }
  }
  
  // DOI
  if (record.doi) {
    fields.push(`  doi = {${record.doi}}`);
  }
  
  // URL
  if (record.landingPage) {
    fields.push(`  url = {${record.landingPage}}`);
  } else if (record.bestPdfUrl) {
    fields.push(`  url = {${record.bestPdfUrl}}`);
  }
  
  // Abstract
  if (record.abstract) {
    // Truncate abstract if too long
    const abstractText = record.abstract.length > 500 
      ? record.abstract.slice(0, 500) + '...'
      : record.abstract;
    fields.push(`  abstract = {${escapeBibTeX(abstractText)}}`);
  }
  
  // Keywords
  if (record.topics && record.topics.length > 0) {
    fields.push(`  keywords = {${record.topics.join(', ')}}`);
  }
  
  // Note about source
  fields.push(`  note = {Retrieved from ${record.source.toUpperCase()}}`);
  
  // Build complete entry
  return `@${entryType}{${citationKey},\n${fields.join(',\n')}\n}`;
}

/**
 * Generate BibTeX for multiple records
 */
export function generateBibTeXBatch(records: OARecord[]): string {
  return records.map(record => generateBibTeX(record)).join('\n\n');
}

/**
 * Determine BibTeX entry type
 */
function determineEntryType(record: OARecord): string {
  // Check OA status
  if (record.oaStatus === 'preprint') {
    return 'misc'; // or 'unpublished'
  }
  
  // Check source
  if (record.source === 'arxiv' || record.source === 'biorxiv' || record.source === 'medrxiv') {
    return 'misc'; // Preprints
  }
  
  // Check if it's a conference paper
  if (record.venue) {
    const venueLower = record.venue.toLowerCase();
    if (venueLower.includes('conference') || 
        venueLower.includes('proceedings') ||
        venueLower.includes('workshop') ||
        venueLower.includes('symposium')) {
      return 'inproceedings';
    }
  }
  
  // Default to article
  return 'article';
}

/**
 * Generate citation key
 */
function generateCitationKey(record: OARecord): string {
  let key = '';
  
  // First author's last name
  if (record.authors && record.authors.length > 0) {
    const firstAuthor = record.authors[0];
    const lastName = firstAuthor.split(' ').pop() || firstAuthor;
    key += lastName.replace(/[^a-zA-Z]/g, '');
  } else {
    key += 'Unknown';
  }
  
  // Year
  if (record.year) {
    key += record.year;
  }
  
  // First word of title
  if (record.title) {
    const firstWord = record.title.split(' ')[0].replace(/[^a-zA-Z]/g, '');
    if (firstWord) {
      key += firstWord;
    }
  }
  
  return key || 'Unknown';
}

/**
 * Escape special BibTeX characters
 */
function escapeBibTeX(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/%/g, '\\%')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\$/g, '\\$');
}

/**
 * Download BibTeX file
 */
export function downloadBibTeX(bibtex: string, filename: string = 'references.bib') {
  const blob = new Blob([bibtex], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

