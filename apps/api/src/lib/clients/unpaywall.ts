import axios, { AxiosInstance } from 'axios';
import { getPooledClient } from '../http-client-factory';
import { extractContactEmail } from '../contact-email';
import { getServiceConfig } from '../http-pool-config';
import { log } from '../logger';

export interface UnpaywallResponse {
  doi: string;
  title: string;
  journal_name: string;
  publisher: string;
  oa_locations: Array<{
    url_for_pdf?: string;
    url_for_landing_page: string;
    host_type: 'publisher' | 'repository';
    license?: string;
    version: 'submittedVersion' | 'acceptedVersion' | 'publishedVersion';
    updated: string;
  }>;
  best_oa_location?: {
    url_for_pdf?: string;
    url_for_landing_page: string;
    host_type: 'publisher' | 'repository';
    license?: string;
    version: 'submittedVersion' | 'acceptedVersion' | 'publishedVersion';
    updated: string;
  };
  first_oa_location?: {
    url_for_pdf?: string;
    url_for_landing_page: string;
    host_type: 'publisher' | 'repository';
    license?: string;
    version: 'submittedVersion' | 'acceptedVersion' | 'publishedVersion';
    updated: string;
  };
  oa_date?: string;
  year?: number;
  genre?: string;
  is_oa: boolean;
  data_standard: number;
  abstract_inverted_index?: Record<string, number[]>;
  z_authors?: Array<{
    given: string;
    family: string;
    ORCID?: string;
  }>;
}

export class UnpaywallClient {
  private baseUrl = 'https://api.unpaywall.org/v2';
  private userAgent: string;
  private contactEmail?: string;
  private httpClient: AxiosInstance;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
    // Unpaywall requires an address on every request and returns 422 without
    // one, so a missing or placeholder UNPAYWALL_EMAIL is worth saying out
    // loud at construction rather than as a run of failed lookups.
    this.contactEmail = extractContactEmail(userAgent);
    if (!this.contactEmail) {
      log.warn(
        'Unpaywall: no contact address in the User-Agent. Set UNPAYWALL_EMAIL to a real mailbox; requests will be rejected without it.'
      );
    }
    // Initialize pooled HTTP client with Unpaywall-specific configuration
    this.httpClient = getPooledClient(this.baseUrl, getServiceConfig('unpaywall'));
  }

  async resolveDOI(doi: string): Promise<UnpaywallResponse | null> {
    try {
      // Normalize DOI
      const normalizedDOI = this.normalizeDOI(doi);
      
      const response = await this.httpClient.get(`/${normalizedDOI}`, {
        params: {
          email: this.contactEmail
        },
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      log.error('Unpaywall DOI resolution error:', error);
      return null;
    }
  }

  private normalizeDOI(doi: string): string {
    // Remove doi.org prefix and normalize
    let normalized = doi.toLowerCase().trim();
    if (normalized.startsWith('https://doi.org/')) {
      normalized = normalized.replace('https://doi.org/', '');
    } else if (normalized.startsWith('http://doi.org/')) {
      normalized = normalized.replace('http://doi.org/', '');
    } else if (normalized.startsWith('doi:')) {
      normalized = normalized.replace('doi:', '');
    }
    return normalized;
  }

  // Helper method to get best PDF URL
  static getBestPdfUrl(response: UnpaywallResponse): string | undefined {
    // Prefer publisher PDFs over repository PDFs
    const publisherPdf = response.oa_locations?.find(loc => 
      loc.host_type === 'publisher' && loc.url_for_pdf
    )?.url_for_pdf;
    
    if (publisherPdf) return publisherPdf;
    
    // Fall back to best OA location
    return response.best_oa_location?.url_for_pdf;
  }

  // Helper method to get license

  // Helper method to get OA version

  // Helper method to reconstruct abstract from inverted index
  static reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    if (!invertedIndex) return '';
    
    const words: Array<{ word: string; position: number }> = [];
    
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const position of positions) {
        words.push({ word, position });
      }
    }
    
    words.sort((a, b) => a.position - b.position);
    return words.map(w => w.word).join(' ');
  }
}
