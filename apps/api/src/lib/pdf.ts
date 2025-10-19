import axios from 'axios';
import { OARecord } from '@open-access-explorer/shared';

export async function resolveBestPdf(record: OARecord): Promise<string | null> {
  const candidates = [
    record.bestPdfUrl,
    candidateFromArxiv(record),
    candidateFromEuropePMC(record),
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
    return response.status === 200 && contentType.startsWith('application/pdf');
  } catch (error) {
    return false;
  }
}

function candidateFromArxiv(record: OARecord): string | null {
  if (record.source === 'arxiv' && record.sourceId) {
    return `https://arxiv.org/pdf/${record.sourceId}`;
  }
  return null;
}

function candidateFromEuropePMC(record: OARecord): string | null {
  if (record.source === 'europepmc' && record.sourceId) {
    return `https://europepmc.org/articles/${record.sourceId}/pdf`;
  }
  return null;
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
