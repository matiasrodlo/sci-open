import axios from 'axios';
import { OARecord } from '@open-access-explorer/shared';

export async function resolveBestPdf(record: OARecord): Promise<string | null> {
  const candidates = [
    record.bestPdfUrl,
    candidateFromArxiv(record),
    ...candidatesFromEuropePMC(record), // Multiple candidates for Europe PMC
    candidateFromCORE(record),
    candidateFromNCBI(record),
    record.landingPage
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    if (await looksLikePdf(url)) {
      return url;
    }
  }
  return null;
}

async function looksLikePdf(url: string): Promise<boolean> {
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
    return `https://core.ac.uk/download/pdf/${record.sourceId}.pdf`;
  }
  return null;
}

function candidateFromNCBI(record: OARecord): string | null {
  if (record.source === 'ncbi' && record.sourceId) {
    // Try PMC PDF if available
    return `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${record.sourceId}/pdf/`;
  }
  return null;
}
