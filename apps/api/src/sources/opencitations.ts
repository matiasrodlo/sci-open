import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

/**
 * OpenCitations API Integration
 * Open citations index for academic papers
 * API Docs: https://opencitations.net/index/coci/api/v1
 */

interface OpenCitationsResult {
  oci: string;
  citing: string;
  cited: string;
  creation: string;
  timespan: string;
  journal_sc: string;
  author_sc: string;
}

interface OpenCitationsResponse {
  [key: string]: OpenCitationsResult[];
}

export class OpenCitationsConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = 'https://opencitations.net/index/coci/api/v1', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords } = params;

    console.log('🔍 OpenCitations search called with params:', params);

    try {
      if (!doi) {
        // OpenCitations primarily works with DOIs for citation data
        // For keyword searches, we'd need to use a different approach
        console.log('OpenCitations requires DOI for citation search');
        return [];
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Get citations for the given DOI
      const response = await axios.get<OpenCitationsResponse>(`${this.baseUrl}/citations/${doi}`, {
        headers,
        timeout: 15000
      });

      console.log(`OpenCitations response status: ${response.status}, citations count: ${Object.keys(response.data).length}`);

      // Convert citation data to OARecord format
      const records: OARecord[] = [];
      
      for (const [citingDoi, citations] of Object.entries(response.data)) {
        if (citations && citations.length > 0) {
          // Create a record for the citing paper
          const record: OARecord = {
            id: `opencitations:${citingDoi}`,
            doi: citingDoi,
            title: `Paper cited by ${doi}`,
            authors: [],
            source: 'opencitations',
            sourceId: citingDoi,
            oaStatus: 'published',
            landingPage: `https://doi.org/${citingDoi}`,
            createdAt: new Date().toISOString(),
            topics: ['citation']
          };

          // Add citation metadata
          const citation = citations[0];
          if (citation) {
            record.year = new Date(citation.creation).getFullYear();
            record.venue = citation.journal_sc || 'Unknown Journal';
          }

          records.push(record);
        }
      }

      console.log(`OpenCitations returning ${records.length} citation records`);
      return records;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('OpenCitations search error:', error.message);
        if (error.response) {
          console.error('OpenCitations error status:', error.response.status);
          console.error('OpenCitations error data:', error.response.data);
        }
      } else {
        console.error('OpenCitations unexpected error:', error);
      }
      return [];
    }
  }
}
