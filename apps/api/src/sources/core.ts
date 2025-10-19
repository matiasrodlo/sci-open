import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

export class CoreConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string = 'https://api.core.ac.uk/v3', apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;

    // Skip CORE if no API key is provided
    if (!this.apiKey) {
      console.log('CORE API key not provided, skipping CORE search');
      return [];
    }

    try {
      let query = '';
      
      if (doi) {
        query = `doi:"${doi}"`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        return [];
      }

      const searchParams: any = {
        q: query,
        limit: 50,
        offset: 0,
      };

      // Add year filter if provided
      if (yearFrom || yearTo) {
        const yearFilter = [];
        if (yearFrom) yearFilter.push(`yearPublished:>=${yearFrom}`);
        if (yearTo) yearFilter.push(`yearPublished:<=${yearTo}`);
        if (yearFilter.length > 0) {
          searchParams.filters = yearFilter.join(' AND ');
        }
      }

      const response = await axios.get(`${this.baseUrl}/search/works`, {
        params: searchParams,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 5000
      });

      const results = response.data?.results || [];
      return results.map((result: any) => this.normalizeResult(result));
    } catch (error) {
      console.error('CORE search error:', error);
      return [];
    }
  }

  private normalizeResult(result: any): OARecord {
    // Extract authors
    const authors = result.authors?.map((author: any) => 
      author.name || `${author.firstName || ''} ${author.lastName || ''}`.trim()
    ) || [];

    // Determine OA status
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    if (result.isOpenAccess) {
      oaStatus = 'published';
    }

    // Find best PDF URL
    let bestPdfUrl: string | undefined;
    if (result.downloadUrl) {
      bestPdfUrl = result.downloadUrl;
    } else if (result.fullTextIdentifier) {
      bestPdfUrl = result.fullTextIdentifier;
    }

    return {
      id: `core:${result.id}`,
      doi: result.doi,
      title: result.title || '',
      authors,
      year: result.yearPublished,
      venue: result.publishedVenue?.name || result.journal?.name,
      abstract: result.abstract,
      source: 'core',
      sourceId: result.id?.toString() || '',
      oaStatus,
      bestPdfUrl,
      landingPage: result.links?.find((link: any) => link.type === 'display')?.url,
      topics: result.topics?.map((topic: any) => topic.label) || [],
      language: result.language?.name || 'en',
      createdAt: result.depositedDate || new Date().toISOString(),
    };
  }
}
