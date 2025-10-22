import { OARecord } from '@open-access-explorer/shared';

export type CitationFormat = 
  | 'bibtex'
  | 'endnote'
  | 'ris'
  | 'wos'
  | 'apa'
  | 'mla'
  | 'chicago'
  | 'harvard'
  | 'vancouver'
  | 'plain';

export interface CitationOptions {
  format: CitationFormat;
  includeAbstract?: boolean;
  includeKeywords?: boolean;
  includeDOI?: boolean;
  includeURL?: boolean;
  maxAuthors?: number;
}

/**
 * Enhanced citation data with additional metadata
 */
export interface EnhancedCitationData {
  // Basic fields
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  keywords?: string[];
  
  // Enhanced fields for WoS-level citations
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  startPage?: string;
  endPage?: string;
  articleNumber?: string;
  language?: string;
  documentType?: string;
  source?: string;
  sourceId?: string;
  oaStatus?: string;
  citationCount?: number;
  
  // Additional metadata
  issn?: string;
  isbn?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  researchAreas?: string[];
  fundingInfo?: string[];
  affiliations?: string[];
}

/**
 * Convert OARecord to enhanced citation data
 */
export function enhanceCitationData(record: OARecord): EnhancedCitationData {
  // Extract additional metadata from various sources
  const enhanced: EnhancedCitationData = {
    title: record.title,
    authors: record.authors,
    year: record.year,
    venue: record.venue,
    abstract: record.abstract,
    doi: record.doi,
    url: record.landingPage || record.bestPdfUrl,
    keywords: record.topics,
    language: record.language,
    source: record.source,
    sourceId: record.sourceId,
    oaStatus: record.oaStatus,
    citationCount: record.citationCount,
  };

  // Extract additional metadata from DOI or other sources
  if (record.doi) {
    // Try to extract volume, issue, pages from DOI or venue
    const venueInfo = extractVenueInfo(record.venue || '');
    enhanced.publisher = venueInfo.publisher;
    enhanced.volume = venueInfo.volume;
    enhanced.issue = venueInfo.issue;
    enhanced.pages = venueInfo.pages;
    enhanced.startPage = venueInfo.startPage;
    enhanced.endPage = venueInfo.endPage;
  }

  // Determine document type
  enhanced.documentType = determineDocumentType(record);

  // Extract research areas from topics
  if (record.topics) {
    enhanced.researchAreas = record.topics.slice(0, 5); // Top 5 topics
  }

  return enhanced;
}

/**
 * Generate citation in specified format
 */
export function generateCitation(record: OARecord, options: CitationOptions): string {
  const enhanced = enhanceCitationData(record);
  
  switch (options.format) {
    case 'bibtex':
      return generateBibTeX(enhanced, options);
    case 'endnote':
      return generateEndNote(enhanced, options);
    case 'ris':
      return generateRIS(enhanced, options);
    case 'wos':
      return generateWoS(enhanced, options);
    case 'apa':
      return generateAPA(enhanced, options);
    case 'mla':
      return generateMLA(enhanced, options);
    case 'chicago':
      return generateChicago(enhanced, options);
    case 'harvard':
      return generateHarvard(enhanced, options);
    case 'vancouver':
      return generateVancouver(enhanced, options);
    case 'plain':
      return generatePlainText(enhanced, options);
    default:
      return generatePlainText(enhanced, options);
  }
}

/**
 * Generate BibTeX citation (enhanced version)
 */
function generateBibTeX(data: EnhancedCitationData, options: CitationOptions): string {
  const entryType = determineBibTeXEntryType(data);
  const citationKey = generateBibTeXKey(data);
  
  const fields: string[] = [];
  
  // Required fields
  if (data.title) {
    fields.push(`  title = {${escapeBibTeX(data.title)}}`);
  }
  
  if (data.authors && data.authors.length > 0) {
    const authors = options.maxAuthors && data.authors.length > options.maxAuthors
      ? data.authors.slice(0, options.maxAuthors).join(' and ') + ' and others'
      : data.authors.join(' and ');
    fields.push(`  author = {${authors}}`);
  }
  
  if (data.year) {
    fields.push(`  year = {${data.year}}`);
  }
  
  // Venue/Journal
  if (data.venue) {
    if (entryType === 'article') {
      fields.push(`  journal = {${escapeBibTeX(data.venue)}}`);
    } else if (entryType === 'inproceedings') {
      fields.push(`  booktitle = {${escapeBibTeX(data.venue)}}`);
    }
  }
  
  // Publisher
  if (data.publisher) {
    fields.push(`  publisher = {${escapeBibTeX(data.publisher)}}`);
  }
  
  // Volume and issue
  if (data.volume) {
    fields.push(`  volume = {${data.volume}}`);
  }
  
  if (data.issue) {
    fields.push(`  number = {${data.issue}}`);
  }
  
  // Pages
  if (data.pages) {
    fields.push(`  pages = {${data.pages}}`);
  } else if (data.startPage && data.endPage) {
    fields.push(`  pages = {${data.startPage}--${data.endPage}}`);
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    fields.push(`  doi = {${data.doi}}`);
  }
  
  // URL
  if (data.url && options.includeURL !== false) {
    fields.push(`  url = {${data.url}}`);
  }
  
  // Abstract
  if (data.abstract && options.includeAbstract) {
    const abstract = data.abstract.length > 500 
      ? data.abstract.slice(0, 500) + '...'
      : data.abstract;
    fields.push(`  abstract = {${escapeBibTeX(abstract)}}`);
  }
  
  // Keywords
  if (data.keywords && data.keywords.length > 0 && options.includeKeywords) {
    fields.push(`  keywords = {${data.keywords.join(', ')}}`);
  }
  
  // Additional metadata
  if (data.issn) {
    fields.push(`  issn = {${data.issn}}`);
  }
  
  if (data.isbn) {
    fields.push(`  isbn = {${data.isbn}}`);
  }
  
  // Note about source and OA status
  const noteParts = [];
  if (data.source) {
    noteParts.push(`Retrieved from ${data.source.toUpperCase()}`);
  }
  if (data.oaStatus) {
    noteParts.push(`OA Status: ${data.oaStatus}`);
  }
  if (data.citationCount) {
    noteParts.push(`Citations: ${data.citationCount}`);
  }
  
  if (noteParts.length > 0) {
    fields.push(`  note = {${noteParts.join(', ')}}`);
  }
  
  return `@${entryType}{${citationKey},\n${fields.join(',\n')}\n}`;
}

/**
 * Generate EndNote format
 */
function generateEndNote(data: EnhancedCitationData, options: CitationOptions): string {
  const lines: string[] = [];
  
  lines.push(`%0 ${determineEndNoteType(data)}`);
  
  if (data.title) {
    lines.push(`%T ${data.title}`);
  }
  
  if (data.authors && data.authors.length > 0) {
    data.authors.forEach(author => {
      lines.push(`%A ${author}`);
    });
  }
  
  if (data.year) {
    lines.push(`%D ${data.year}`);
  }
  
  if (data.venue) {
    lines.push(`%J ${data.venue}`);
  }
  
  if (data.publisher) {
    lines.push(`%I ${data.publisher}`);
  }
  
  if (data.volume) {
    lines.push(`%V ${data.volume}`);
  }
  
  if (data.issue) {
    lines.push(`%N ${data.issue}`);
  }
  
  if (data.pages) {
    lines.push(`%P ${data.pages}`);
  }
  
  if (data.doi && options.includeDOI !== false) {
    lines.push(`%R ${data.doi}`);
  }
  
  if (data.url && options.includeURL !== false) {
    lines.push(`%U ${data.url}`);
  }
  
  if (data.abstract && options.includeAbstract) {
    lines.push(`%X ${data.abstract}`);
  }
  
  if (data.keywords && data.keywords.length > 0 && options.includeKeywords) {
    data.keywords.forEach(keyword => {
      lines.push(`%K ${keyword}`);
    });
  }
  
  if (data.issn) {
    lines.push(`%@ ${data.issn}`);
  }
  
  if (data.language) {
    lines.push(`%G ${data.language}`);
  }
  
  lines.push(''); // Empty line at end
  
  return lines.join('\n');
}

/**
 * Generate RIS format
 */
function generateRIS(data: EnhancedCitationData, options: CitationOptions): string {
  const lines: string[] = [];
  
  lines.push(`TY  - ${determineRISType(data)}`);
  
  if (data.title) {
    lines.push(`TI  - ${data.title}`);
  }
  
  if (data.authors && data.authors.length > 0) {
    data.authors.forEach(author => {
      lines.push(`AU  - ${author}`);
    });
  }
  
  if (data.year) {
    lines.push(`PY  - ${data.year}`);
  }
  
  if (data.venue) {
    lines.push(`T2  - ${data.venue}`);
  }
  
  if (data.publisher) {
    lines.push(`PB  - ${data.publisher}`);
  }
  
  if (data.volume) {
    lines.push(`VL  - ${data.volume}`);
  }
  
  if (data.issue) {
    lines.push(`IS  - ${data.issue}`);
  }
  
  if (data.pages) {
    lines.push(`SP  - ${data.pages}`);
  }
  
  if (data.doi && options.includeDOI !== false) {
    lines.push(`DO  - ${data.doi}`);
  }
  
  if (data.url && options.includeURL !== false) {
    lines.push(`UR  - ${data.url}`);
  }
  
  if (data.abstract && options.includeAbstract) {
    lines.push(`AB  - ${data.abstract}`);
  }
  
  if (data.keywords && data.keywords.length > 0 && options.includeKeywords) {
    data.keywords.forEach(keyword => {
      lines.push(`KW  - ${keyword}`);
    });
  }
  
  if (data.issn) {
    lines.push(`SN  - ${data.issn}`);
  }
  
  if (data.language) {
    lines.push(`LA  - ${data.language}`);
  }
  
  lines.push('ER  - '); // End of record
  
  return lines.join('\n');
}

/**
 * Generate Web of Science format
 */
function generateWoS(data: EnhancedCitationData, options: CitationOptions): string {
  const lines: string[] = [];
  
  // WoS format is similar to EndNote but with specific field mappings
  lines.push(`PT ${determineWoSType(data)}`);
  
  if (data.title) {
    lines.push(`TI ${data.title}`);
  }
  
  if (data.authors && data.authors.length > 0) {
    data.authors.forEach(author => {
      lines.push(`AU ${author}`);
    });
  }
  
  if (data.year) {
    lines.push(`PY ${data.year}`);
  }
  
  if (data.venue) {
    lines.push(`SO ${data.venue}`);
  }
  
  if (data.publisher) {
    lines.push(`PU ${data.publisher}`);
  }
  
  if (data.volume) {
    lines.push(`VL ${data.volume}`);
  }
  
  if (data.issue) {
    lines.push(`IS ${data.issue}`);
  }
  
  if (data.pages) {
    lines.push(`BP ${data.pages}`);
  }
  
  if (data.doi && options.includeDOI !== false) {
    lines.push(`DI ${data.doi}`);
  }
  
  if (data.url && options.includeURL !== false) {
    lines.push(`UR ${data.url}`);
  }
  
  if (data.abstract && options.includeAbstract) {
    lines.push(`AB ${data.abstract}`);
  }
  
  if (data.keywords && data.keywords.length > 0 && options.includeKeywords) {
    data.keywords.forEach(keyword => {
      lines.push(`DE ${keyword}`);
    });
  }
  
  if (data.issn) {
    lines.push(`SN ${data.issn}`);
  }
  
  if (data.language) {
    lines.push(`LA ${data.language}`);
  }
  
  if (data.citationCount) {
    lines.push(`TC ${data.citationCount}`);
  }
  
  lines.push('ER'); // End of record
  
  return lines.join('\n');
}

/**
 * Generate APA style citation
 */
function generateAPA(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 20;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      const lastAuthor = data.authors[data.authors.length - 1];
      const otherAuthors = data.authors.slice(0, -1);
      authorStr = otherAuthors.join(', ') + ', & ' + lastAuthor;
    } else {
      const firstAuthors = data.authors.slice(0, maxAuthors - 1);
      authorStr = firstAuthors.join(', ') + ', ... ' + data.authors[data.authors.length - 1];
    }
    
    parts.push(authorStr);
  }
  
  // Year
  if (data.year) {
    parts.push(`(${data.year})`);
  }
  
  // Title
  if (data.title) {
    parts.push(data.title + '.');
  }
  
  // Venue
  if (data.venue) {
    let venueStr = data.venue;
    if (data.volume) {
      venueStr += `, ${data.volume}`;
    }
    if (data.issue) {
      venueStr += `(${data.issue})`;
    }
    if (data.pages) {
      venueStr += `, ${data.pages}`;
    }
    parts.push(venueStr + '.');
  }
  
  // Publisher
  if (data.publisher) {
    parts.push(data.publisher + '.');
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`https://doi.org/${data.doi}`);
  }
  
  return parts.join(' ');
}

/**
 * Generate MLA style citation
 */
function generateMLA(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 3;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      authorStr = data.authors.join(', ');
    } else {
      authorStr = data.authors.slice(0, maxAuthors - 1).join(', ') + ', et al.';
    }
    
    parts.push(authorStr + '.');
  }
  
  // Title
  if (data.title) {
    parts.push(`"${data.title}."`);
  }
  
  // Venue
  if (data.venue) {
    let venueStr = data.venue;
    if (data.volume) {
      venueStr += `, vol. ${data.volume}`;
    }
    if (data.issue) {
      venueStr += `, no. ${data.issue}`;
    }
    if (data.year) {
      venueStr += `, ${data.year}`;
    }
    if (data.pages) {
      venueStr += `, pp. ${data.pages}`;
    }
    parts.push(venueStr + '.');
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`DOI: ${data.doi}.`);
  }
  
  return parts.join(' ');
}

/**
 * Generate Chicago style citation
 */
function generateChicago(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 10;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      const lastAuthor = data.authors[data.authors.length - 1];
      const otherAuthors = data.authors.slice(0, -1);
      authorStr = otherAuthors.join(', ') + ', and ' + lastAuthor;
    } else {
      const firstAuthors = data.authors.slice(0, maxAuthors - 1);
      authorStr = firstAuthors.join(', ') + ', et al.';
    }
    
    parts.push(authorStr + '.');
  }
  
  // Title
  if (data.title) {
    parts.push(`"${data.title}."`);
  }
  
  // Venue
  if (data.venue) {
    let venueStr = data.venue;
    if (data.volume) {
      venueStr += ` ${data.volume}`;
    }
    if (data.issue) {
      venueStr += `, no. ${data.issue}`;
    }
    if (data.year) {
      venueStr += ` (${data.year})`;
    }
    if (data.pages) {
      venueStr += `: ${data.pages}`;
    }
    parts.push(venueStr + '.');
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`https://doi.org/${data.doi}.`);
  }
  
  return parts.join(' ');
}

/**
 * Generate Harvard style citation
 */
function generateHarvard(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 3;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      authorStr = data.authors.join(', ');
    } else {
      authorStr = data.authors.slice(0, maxAuthors - 1).join(', ') + ' et al.';
    }
    
    parts.push(authorStr);
  }
  
  // Year
  if (data.year) {
    parts.push(`(${data.year})`);
  }
  
  // Title
  if (data.title) {
    parts.push(data.title + '.');
  }
  
  // Venue
  if (data.venue) {
    let venueStr = data.venue;
    if (data.volume) {
      venueStr += `, ${data.volume}`;
    }
    if (data.issue) {
      venueStr += `(${data.issue})`;
    }
    if (data.pages) {
      venueStr += `, pp. ${data.pages}`;
    }
    parts.push(venueStr + '.');
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`DOI: ${data.doi}.`);
  }
  
  return parts.join(' ');
}

/**
 * Generate Vancouver style citation
 */
function generateVancouver(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 6;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      authorStr = data.authors.join(', ');
    } else {
      authorStr = data.authors.slice(0, maxAuthors - 1).join(', ') + ' et al.';
    }
    
    parts.push(authorStr + '.');
  }
  
  // Title
  if (data.title) {
    parts.push(data.title + '.');
  }
  
  // Venue
  if (data.venue) {
    let venueStr = data.venue;
    if (data.year) {
      venueStr += `. ${data.year}`;
    }
    if (data.volume) {
      venueStr += `;${data.volume}`;
    }
    if (data.issue) {
      venueStr += `(${data.issue})`;
    }
    if (data.pages) {
      venueStr += `:${data.pages}`;
    }
    parts.push(venueStr + '.');
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`DOI: ${data.doi}.`);
  }
  
  return parts.join(' ');
}

/**
 * Generate plain text citation
 */
function generatePlainText(data: EnhancedCitationData, options: CitationOptions): string {
  const parts: string[] = [];
  
  // Authors
  if (data.authors && data.authors.length > 0) {
    const maxAuthors = options.maxAuthors || 3;
    let authorStr = '';
    
    if (data.authors.length === 1) {
      authorStr = data.authors[0];
    } else if (data.authors.length <= maxAuthors) {
      authorStr = data.authors.join(', ');
    } else {
      authorStr = data.authors.slice(0, maxAuthors - 1).join(', ') + ' et al.';
    }
    
    parts.push(authorStr);
  }
  
  // Year
  if (data.year) {
    parts.push(`(${data.year})`);
  }
  
  // Title
  if (data.title) {
    parts.push(data.title);
  }
  
  // Venue
  if (data.venue) {
    parts.push(data.venue);
  }
  
  // DOI
  if (data.doi && options.includeDOI !== false) {
    parts.push(`DOI: ${data.doi}`);
  }
  
  return parts.join('. ');
}

// Helper functions

function determineBibTeXEntryType(data: EnhancedCitationData): string {
  if (data.oaStatus === 'preprint' || data.source === 'arxiv' || data.source === 'biorxiv' || data.source === 'medrxiv') {
    return 'misc';
  }
  
  if (data.venue) {
    const venueLower = data.venue.toLowerCase();
    if (venueLower.includes('conference') || venueLower.includes('proceedings') || 
        venueLower.includes('workshop') || venueLower.includes('symposium')) {
      return 'inproceedings';
    }
  }
  
  return 'article';
}

function determineEndNoteType(data: EnhancedCitationData): string {
  if (data.oaStatus === 'preprint' || data.source === 'arxiv' || data.source === 'biorxiv' || data.source === 'medrxiv') {
    return 'Generic';
  }
  
  if (data.venue) {
    const venueLower = data.venue.toLowerCase();
    if (venueLower.includes('conference') || venueLower.includes('proceedings') || 
        venueLower.includes('workshop') || venueLower.includes('symposium')) {
      return 'Conference Proceedings';
    }
  }
  
  return 'Journal Article';
}

function determineRISType(data: EnhancedCitationData): string {
  if (data.oaStatus === 'preprint' || data.source === 'arxiv' || data.source === 'biorxiv' || data.source === 'medrxiv') {
    return 'GEN';
  }
  
  if (data.venue) {
    const venueLower = data.venue.toLowerCase();
    if (venueLower.includes('conference') || venueLower.includes('proceedings') || 
        venueLower.includes('workshop') || venueLower.includes('symposium')) {
      return 'CONF';
    }
  }
  
  return 'JOUR';
}

function determineWoSType(data: EnhancedCitationData): string {
  if (data.oaStatus === 'preprint' || data.source === 'arxiv' || data.source === 'biorxiv' || data.source === 'medrxiv') {
    return 'Generic';
  }
  
  if (data.venue) {
    const venueLower = data.venue.toLowerCase();
    if (venueLower.includes('conference') || venueLower.includes('proceedings') || 
        venueLower.includes('workshop') || venueLower.includes('symposium')) {
      return 'Conference Proceedings';
    }
  }
  
  return 'Journal Article';
}

function determineDocumentType(data: OARecord): string {
  if (data.oaStatus === 'preprint') {
    return 'Preprint';
  }
  
  if (data.source === 'arxiv' || data.source === 'biorxiv' || data.source === 'medrxiv') {
    return 'Preprint';
  }
  
  if (data.venue) {
    const venueLower = data.venue.toLowerCase();
    if (venueLower.includes('conference') || venueLower.includes('proceedings') || 
        venueLower.includes('workshop') || venueLower.includes('symposium')) {
      return 'Conference Paper';
    }
  }
  
  return 'Journal Article';
}

function generateBibTeXKey(data: EnhancedCitationData): string {
  let key = '';
  
  // First author's last name
  if (data.authors && data.authors.length > 0) {
    const firstAuthor = data.authors[0];
    const lastName = firstAuthor.split(' ').pop() || firstAuthor;
    key += lastName.replace(/[^a-zA-Z]/g, '');
  } else {
    key += 'Unknown';
  }
  
  // Year
  if (data.year) {
    key += data.year;
  }
  
  // First word of title
  if (data.title) {
    const firstWord = data.title.split(' ')[0].replace(/[^a-zA-Z]/g, '');
    if (firstWord) {
      key += firstWord;
    }
  }
  
  return key;
}

function extractVenueInfo(venue: string): {
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  startPage?: string;
  endPage?: string;
} {
  const info: any = {};
  
  // Try to extract volume, issue, pages from venue string
  // This is a simplified extraction - in practice, you might want more sophisticated parsing
  
  // Volume pattern: "Journal Name, Vol. 123" or "Journal Name 123"
  const volumeMatch = venue.match(/(?:vol\.?\s*|volume\s*)(\d+)/i);
  if (volumeMatch) {
    info.volume = volumeMatch[1];
  }
  
  // Issue pattern: "No. 4" or "Issue 4"
  const issueMatch = venue.match(/(?:no\.?\s*|issue\s*|number\s*)(\d+)/i);
  if (issueMatch) {
    info.issue = issueMatch[1];
  }
  
  // Pages pattern: "pp. 123-456" or "123-456"
  const pagesMatch = venue.match(/(?:pp\.?\s*)?(\d+)\s*[-–]\s*(\d+)/i);
  if (pagesMatch) {
    info.startPage = pagesMatch[1];
    info.endPage = pagesMatch[2];
    info.pages = `${pagesMatch[1]}-${pagesMatch[2]}`;
  }
  
  return info;
}

function escapeBibTeX(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}');
}

/**
 * Generate citations for multiple records
 */
export function generateCitationsBatch(records: OARecord[], options: CitationOptions): string {
  return records.map(record => generateCitation(record, options)).join('\n\n');
}

/**
 * Download citation file
 */
export function downloadCitation(citation: string, filename: string, format: CitationFormat): void {
  const blob = new Blob([citation], { 
    type: getMimeType(format) 
  });
  
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

function getMimeType(format: CitationFormat): string {
  switch (format) {
    case 'bibtex':
      return 'application/x-bibtex';
    case 'endnote':
    case 'ris':
    case 'wos':
      return 'application/x-research-info-systems';
    case 'apa':
    case 'mla':
    case 'chicago':
    case 'harvard':
    case 'vancouver':
    case 'plain':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

/**
 * Get file extension for format
 */
export function getFileExtension(format: CitationFormat): string {
  switch (format) {
    case 'bibtex':
      return 'bib';
    case 'endnote':
      return 'enw';
    case 'ris':
      return 'ris';
    case 'wos':
      return 'wos';
    case 'apa':
    case 'mla':
    case 'chicago':
    case 'harvard':
    case 'vancouver':
    case 'plain':
      return 'txt';
    default:
      return 'txt';
  }
}
