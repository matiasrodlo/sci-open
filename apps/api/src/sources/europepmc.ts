import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

export class EuropePMCConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://www.ebi.ac.uk/europepmc/webservices/rest') {
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
      let query = '';
      
      if (doi) {
        query = `DOI:"${doi}"`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        return [];
      }

      const searchParams: any = {
        query: query,
        format: 'json',
        pageSize: 50,
        resultType: 'core',
        sortBy: 'RELEVANCE',
      };

      // Add year filter if provided
      if (yearFrom || yearTo) {
        const yearFilter = [];
        if (yearFrom) yearFilter.push(`PUB_YEAR:>=${yearFrom}`);
        if (yearTo) yearFilter.push(`PUB_YEAR:<=${yearTo}`);
        if (yearFilter.length > 0) {
          searchParams.query = `${searchParams.query} AND (${yearFilter.join(' AND ')})`;
        }
      }

      const response = await axios.get(`${this.baseUrl}/search`, {
        params: searchParams,
        timeout: 5000
      });

      const results = response.data?.resultList?.result || [];
      return results.map((result: any) => this.normalizeResult(result));
    } catch (error) {
      console.error('Europe PMC search error:', error);
      return [];
    }
  }

  private normalizeResult(result: any): OARecord {
    // Extract authors
    const authors = result.authorList?.author?.map((author: any) => 
      `${author.firstName || ''} ${author.lastName || ''}`.trim()
    ) || [];

    // Determine OA status
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    if (result.isOpenAccess === 'Y') {
      oaStatus = 'published';
    }

    // Find best PDF URL from full text URLs
    let bestPdfUrl: string | undefined;
    if (result.fullTextUrlList?.fullTextUrl) {
      const pdfUrl = result.fullTextUrlList.fullTextUrl.find((url: any) => 
        url.documentStyle === 'pdf' || url.url?.includes('.pdf')
      );
      bestPdfUrl = pdfUrl?.url;
    }

    // Extract topics from keywords
    const topics = [];
    if (result.keywordList?.keyword) {
      topics.push(...result.keywordList.keyword);
    }

    return {
      id: `europepmc:${result.id}`,
      doi: result.doi,
      title: result.title || '',
      authors,
      year: result.pubYear ? parseInt(result.pubYear) : undefined,
      venue: result.journalTitle,
      abstract: result.abstractText,
      source: 'europepmc',
      sourceId: result.id?.toString() || '',
      oaStatus,
      bestPdfUrl,
      landingPage: result.fullTextUrlList?.fullTextUrl?.find((url: any) => 
        url.documentStyle === 'html'
      )?.url,
      topics,
      language: result.language || 'en',
      createdAt: result.firstPublicationDate || new Date().toISOString(),
    };
  }
}
