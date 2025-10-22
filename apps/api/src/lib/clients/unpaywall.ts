import axios, { AxiosInstance } from 'axios';
import { getPooledClient } from '../http-client-factory';
import { getServiceConfig } from '../http-pool-config';

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
  private httpClient: AxiosInstance;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
    // Initialize pooled HTTP client with Unpaywall-specific configuration
    this.httpClient = getPooledClient(this.baseUrl, getServiceConfig('unpaywall'));
  }

  async resolveDOI(doi: string): Promise<UnpaywallResponse | null> {
    try {
      // Normalize DOI
      const normalizedDOI = this.normalizeDOI(doi);
      
      const response = await this.httpClient.get(`/${normalizedDOI}`, {
        params: {
          email: this.userAgent.includes('mailto:') ? 
            this.userAgent.split('mailto:')[1].split(' ')[0] : 
            'your-email@example.com'
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
      console.error('Unpaywall DOI resolution error:', error);
      return null;
    }
  }

  async resolveDOIs(dois: string[]): Promise<Map<string, UnpaywallResponse>> {
    const results = new Map<string, UnpaywallResponse>();
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < dois.length; i += batchSize) {
      const batch = dois.slice(i, i + batchSize);
      
      const promises = batch.map(async (doi) => {
        try {
          const result = await this.resolveDOI(doi);
          if (result) {
            results.set(doi, result);
          }
        } catch (error) {
          console.error(`Unpaywall error for DOI ${doi}:`, error);
        }
      });

      await Promise.allSettled(promises);
      
      // Add small delay between batches to be polite
      if (i + batchSize < dois.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
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
  static getLicense(response: UnpaywallResponse): string | undefined {
    // Prefer publisher license
    const publisherLicense = response.oa_locations?.find(loc => 
      loc.host_type === 'publisher' && loc.license
    )?.license;
    
    if (publisherLicense) return publisherLicense;
    
    // Fall back to best OA location license
    return response.best_oa_location?.license;
  }

  // Helper method to get OA version
  static getOAVersion(response: UnpaywallResponse): string | undefined {
    // Prefer published version
    const publishedVersion = response.oa_locations?.find(loc => 
      loc.version === 'publishedVersion'
    )?.version;
    
    if (publishedVersion) return publishedVersion;
    
    // Fall back to best OA location version
    return response.best_oa_location?.version;
  }

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
