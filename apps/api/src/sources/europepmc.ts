import axios from 'axios';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';
import { log } from '../lib/logger';

// Europe PMC accepts up to 1000 results per request
const MAX_PAGE_SIZE = 1000;

export class EuropePMCConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://www.ebi.ac.uk/europepmc/webservices/rest') {
    this.baseUrl = baseUrl;
  }

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50, offset = 0 } = params;

    try {
      let query = '';
      
      if (doi) {
        query = `DOI:"${doi}"`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        return { records: [] };
      }

      // Restrict to open access. There is no `openAccessOnly` request
      // parameter — passing one is silently ignored and most of the page comes
      // back closed, only to be discarded downstream. OPEN_ACCESS:y is a query
      // term, so it also makes the reported hitCount reflect the OA subset.
      query = `${query} AND OPEN_ACCESS:y`;

      const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

      const searchParams: any = {
        query: query,
        format: 'json',
        pageSize,
        // The API pages by 1-based page number, so an offset only lands
        // exactly when it falls on a page boundary
        page: Math.floor(offset / pageSize) + 1,
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
        // A full 'core' result set runs to several megabytes, and decoding it
        // competes with every other connector on the same thread. This is a
        // backstop for direct callers; the aggregator's own budget is tighter
        // and is what normally bounds a search.
        timeout: Math.min(10000 + pageSize * 40, 45000)
      });

      const results = response.data?.resultList?.result || [];
      const reported = Number(response.data?.hitCount);

      return {
        records: results.map((result: any) => this.normalizeResult(result)),
        totalHits: Number.isFinite(reported) ? reported : undefined
      };
    } catch (error) {
      log.error('Europe PMC search error:', error);
      return { records: [] };
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
      const urls = Array.isArray(result.fullTextUrlList.fullTextUrl) 
        ? result.fullTextUrlList.fullTextUrl 
        : [result.fullTextUrlList.fullTextUrl];
      
      // Try to find PDF URL
      const pdfUrl = urls.find((url: any) => 
        url.documentStyle === 'pdf' || url.url?.toLowerCase().includes('.pdf')
      );
      
      if (pdfUrl) {
        bestPdfUrl = pdfUrl.url;
      } else if (result.pmcid) {
        // If no direct PDF URL but we have a PMC ID, construct one
        bestPdfUrl = `https://europepmc.org/articles/${result.pmcid}?pdf=render`;
      }
    } else if (result.pmcid) {
      // Fallback: construct URL from PMC ID
      bestPdfUrl = `https://europepmc.org/articles/${result.pmcid}?pdf=render`;
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
