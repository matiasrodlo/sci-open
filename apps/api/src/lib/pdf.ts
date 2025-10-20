import axios from 'axios';
import { OARecord } from '@open-access-explorer/shared';
import { UnpaywallConnector } from '../sources/unpaywall';

const unpaywallConnector = new UnpaywallConnector(process.env.UNPAYWALL_EMAIL || 'your-email@example.com');

export async function resolveBestPdf(record: OARecord): Promise<string | null> {
  const candidates = [
    record.bestPdfUrl,
    candidateFromArxiv(record),
    ...candidatesFromEuropePMC(record), // Multiple candidates for Europe PMC
    candidateFromCORE(record),
    candidateFromOpenAIRE(record),
    candidateFromPLOS(record),
    candidateFromNCBI(record),
    record.landingPage
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    if (await looksLikePdf(url)) {
      return url;
    }
  }
  
  // If no PDF found and we have a DOI, try Unpaywall as a last resort
  if (record.doi) {
    console.log(`Trying Unpaywall for DOI: ${record.doi}`);
    const unpaywallPdf = await unpaywallConnector.getPdfByDoi(record.doi);
    if (unpaywallPdf) {
      console.log(`Found PDF via Unpaywall: ${unpaywallPdf}`);
      return unpaywallPdf;
    }
  }
  
  return null;
}

async function looksLikePdf(url: string): Promise<boolean> {
  // CORE reader URLs are always valid (they show the paper with embedded PDF)
  if (url.includes('core.ac.uk/reader/')) {
    return true;
  }
  
  // OpenAIRE landing pages are valid (they provide access to the paper)
  if (url.includes('explore.openaire.eu/search/publication')) {
    return true;
  }
  
  // PLOS article URLs with type=printable are always valid PDFs
  if (url.includes('journals.plos.org') && url.includes('type=printable')) {
    return true;
  }
  
  // Skip validation for fileserver.core.ac.uk (often times out)
  if (url.includes('fileserver.core.ac.uk')) {
    return false;
  }
  
  try {
    const response = await axios.head(url, {
      timeout: 3000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });
    
    const contentType = response.headers['content-type'] || '';
    
    // Accept if it's a PDF or if the URL ends with .pdf or has pdf in query params
    const isPdfContentType = contentType.startsWith('application/pdf');
    const isPdfUrl = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf=render');
    const isOk = response.status === 200 || response.status === 302 || response.status === 301;
    
    return isOk && (isPdfContentType || isPdfUrl);
  } catch (error) {
    // If HEAD fails, assume the URL might still work for GET
    // This is especially true for URLs with pdf=render parameter
    return url.toLowerCase().includes('pdf');
  }
}

function candidateFromArxiv(record: OARecord): string | null {
  if (record.source === 'arxiv' && record.sourceId) {
    return `https://arxiv.org/pdf/${record.sourceId}`;
  }
  return null;
}

function candidatesFromEuropePMC(record: OARecord): string[] {
  if (record.source !== 'europepmc' || !record.sourceId) {
    return [];
  }
  
  const candidates: string[] = [];
  const sourceId = record.sourceId;
  
  // Try different URL patterns for Europe PMC
  // Pattern 1: PMC ID format
  if (sourceId.startsWith('PMC')) {
    candidates.push(`https://europepmc.org/articles/${sourceId}?pdf=render`);
    candidates.push(`https://www.ncbi.nlm.nih.gov/pmc/articles/${sourceId}/pdf/`);
  }
  
  // Pattern 2: Generic article URL
  candidates.push(`https://europepmc.org/article/MED/${sourceId}?pdf=render`);
  
  // Pattern 3: Try as PPR (preprint) ID
  if (!sourceId.startsWith('PMC')) {
    candidates.push(`https://europepmc.org/article/PPR/PPR${sourceId}?pdf=render`);
  }
  
  return candidates;
}

function candidateFromCORE(record: OARecord): string | null {
  if (record.source === 'core' && record.sourceId) {
    // Use CORE reader instead of direct PDF download (more reliable)
    return `https://core.ac.uk/reader/${record.sourceId}`;
  }
  return null;
}

function candidateFromOpenAIRE(record: OARecord): string | null {
  if (record.source === 'openaire') {
    // OpenAIRE provides landing pages that link to the actual paper locations
    // The bestPdfUrl from OpenAIRE connector should already be the best option
    // If it's a DOI link, it will redirect to the publisher
    if (record.bestPdfUrl) {
      return record.bestPdfUrl;
    }
    // Fall back to landing page which shows all available versions
    if (record.landingPage) {
      return record.landingPage;
    }
  }
  return null;
}

function candidateFromPLOS(record: OARecord): string | null {
  // PLOS papers are identified by their DOI prefix 10.1371/journal.
  if (record.doi && record.doi.startsWith('10.1371/journal.')) {
    // PLOS provides direct PDF access via their file parameter
    return `https://journals.plos.org/plosone/article/file?id=${record.doi}&type=printable`;
  }
  return null;
}

function candidateFromNCBI(record: OARecord): string | null {
  // For NCBI, only use bestPdfUrl if it exists (which means a PMC ID was found)
  // Don't try to construct a PMC URL from a PMID - they're different!
  return null;
}
