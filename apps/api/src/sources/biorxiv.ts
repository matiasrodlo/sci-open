import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

/**
 * bioRxiv and medRxiv API Integration
 * Preprint servers for biology and medicine
 * API Docs: https://api.biorxiv.org/
 */

interface BiorxivResult {
  doi: string;
  title: string;
  authors: string;
  author_corresponding?: string;
  date: string;
  version?: string;
  type?: string;
  category?: string;
  jatsxml?: string;
  abstract?: string;
  published?: string;
  server: 'biorxiv' | 'medrxiv';
}

interface BiorxivResponse {
  messages: Array<{
    status: string;
    count: string;
    total: string;
  }>;
  collection: BiorxivResult[];
}

export class BiorxivConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.biorxiv.org') {
    this.baseUrl = baseUrl;
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;

    try {
      let results: OARecord[] = [];

      // If DOI is provided, search by DOI
      if (doi) {
        const doiResults = await this.searchByDoi(doi);
        results = [...results, ...doiResults];
      }

      // If keywords provided, search both bioRxiv and medRxiv
      if (titleOrKeywords) {
        // Search bioRxiv
        const bioRxivResults = await this.searchByKeywords(titleOrKeywords, 'biorxiv', yearFrom, yearTo);
        results = [...results, ...bioRxivResults];

        // Search medRxiv
        const medRxivResults = await this.searchByKeywords(titleOrKeywords, 'medrxiv', yearFrom, yearTo);
        results = [...results, ...medRxivResults];
      }

      return results;
    } catch (error) {
      console.error('bioRxiv/medRxiv search error:', error);
      return [];
    }
  }

  private async searchByDoi(doi: string): Promise<OARecord[]> {
    try {
      // Try both servers
      const servers = ['biorxiv', 'medrxiv'];
      const results: OARecord[] = [];

      for (const server of servers) {
        try {
          const response = await axios.get<BiorxivResponse>(
            `${this.baseUrl}/details/${server}/${doi}`,
            { timeout: 5000 }
          );

          if (response.data.collection && response.data.collection.length > 0) {
            const normalized = response.data.collection.map(item => 
              this.normalizeResult(item, server as 'biorxiv' | 'medrxiv')
            );
            results.push(...normalized);
          }
        } catch (error: any) {
          // 404 is expected if DOI not found in this server
          if (error.response?.status !== 404) {
            console.error(`${server} DOI search error:`, error.message);
          }
        }
      }

      return results;
    } catch (error) {
      console.error('bioRxiv/medRxiv DOI search error:', error);
      return [];
    }
  }

  private async searchByKeywords(
    keywords: string,
    server: 'biorxiv' | 'medrxiv',
    yearFrom?: number,
    yearTo?: number
  ): Promise<OARecord[]> {
    try {
      // The API doesn't support direct keyword search, so we'll use date range
      // and filter by title/abstract match
      // Get recent papers (last 30 days) and filter client-side
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const response = await axios.get<BiorxivResponse>(
        `${this.baseUrl}/details/${server}/${startDateStr}/${endDateStr}`,
        { 
          timeout: 10000,
          params: {
            cursor: 0,
            format: 'json'
          }
        }
      );

      if (!response.data.collection || response.data.collection.length === 0) {
        return [];
      }

      // Filter by keywords and year
      const keywordsLower = keywords.toLowerCase();
      const filtered = response.data.collection.filter(item => {
        // Check if keywords match title or abstract
        const titleMatch = item.title?.toLowerCase().includes(keywordsLower);
        const abstractMatch = item.abstract?.toLowerCase().includes(keywordsLower);
        
        if (!titleMatch && !abstractMatch) return false;

        // Check year range
        if (yearFrom || yearTo) {
          const itemYear = new Date(item.date).getFullYear();
          if (yearFrom && itemYear < yearFrom) return false;
          if (yearTo && itemYear > yearTo) return false;
        }

        return true;
      });

      return filtered.slice(0, 50).map(item => this.normalizeResult(item, server));
    } catch (error: any) {
      // Don't log 404s as errors
      if (error.response?.status !== 404) {
        console.error(`${server} keyword search error:`, error.message);
      }
      return [];
    }
  }

  private normalizeResult(result: BiorxivResult, server: 'biorxiv' | 'medrxiv'): OARecord {
    // Parse authors string (format: "LastName1, FirstName1; LastName2, FirstName2")
    const authors = result.authors
      ? result.authors.split(';').map(author => author.trim()).filter(Boolean)
      : [];

    // Extract year from date
    const year = result.date ? new Date(result.date).getFullYear() : undefined;

    // Construct PDF URL
    const doiParts = result.doi.split('/');
    const doiId = doiParts[doiParts.length - 1];
    const pdfUrl = `https://www.${server}.org/content/${result.doi}v${result.version || '1'}.full.pdf`;

    // Determine source based on server
    const source = server === 'biorxiv' ? 'arxiv' : 'arxiv'; // Map to arxiv type for now
    // Actually, let's use the server name to distinguish

    return {
      id: `${server}:${result.doi}`,
      doi: result.doi,
      title: result.title,
      authors,
      year,
      venue: server === 'biorxiv' ? 'bioRxiv' : 'medRxiv',
      abstract: result.abstract,
      source: server, // Use the actual server name (biorxiv or medrxiv)
      sourceId: result.doi,
      oaStatus: 'preprint',
      bestPdfUrl: pdfUrl,
      landingPage: `https://www.${server}.org/content/${result.doi}v${result.version || '1'}`,
      topics: result.category ? [result.category] : [],
      language: 'en',
      createdAt: result.date || new Date().toISOString(),
      updatedAt: result.published || result.date,
    };
  }
}


