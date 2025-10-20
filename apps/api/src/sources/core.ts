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
        limit: 100,
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
          'Content-Type': 'application/json',
        },
        timeout: 10000,
        maxRedirects: 5,
      });

      const results = response.data?.results || [];
      console.log(`CORE returned ${results.length} results for query: ${query}`);
      return results.map((result: any) => this.normalizeResult(result));
    } catch (error: any) {
      console.error('CORE search error:', error.message);
      if (error.response) {
        console.error('CORE error status:', error.response.status);
        console.error('CORE error data:', JSON.stringify(error.response.data).substring(0, 200));
      }
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
    // CORE's fileserver.core.ac.uk is unreliable, use reader URL instead
    let bestPdfUrl: string | undefined;
    
    // Priority 1: Use CORE reader (most reliable - shows paper with embedded PDF)
    if (result.id) {
      bestPdfUrl = `https://core.ac.uk/reader/${result.id}`;
    }
    
    // Priority 2: Check for direct PDF from repository (if available)
    if (!bestPdfUrl && result.fullTextIdentifier && !result.fullTextIdentifier.includes('fileserver.core.ac.uk')) {
      bestPdfUrl = result.fullTextIdentifier;
    }
    
    // Priority 3: Check links array for non-CORE download links
    const downloadLink = result.links?.find((link: any) => 
      link.type === 'download' && 
      !link.url.includes('core.ac.uk') && 
      !link.url.includes('fileserver.core.ac.uk')
    );
    if (!bestPdfUrl && downloadLink?.url) {
      bestPdfUrl = downloadLink.url;
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
