import axios from 'axios';
import { parseString } from 'xml2js';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';
import { log } from '../lib/logger';

// arXiv asks that a single request stay at or below 2000 results
const MAX_PAGE_SIZE = 2000;

export class ArxivConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://export.arxiv.org/api/query') {
    this.baseUrl = baseUrl;
  }

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50, offset = 0 } = params;

    try {
      let query = '';
      
      if (doi) {
        // For DOI, we can't search arXiv directly by DOI, so return empty
        return { records: [] };
      }

      if (titleOrKeywords) {
        query = `all:${titleOrKeywords}`;
      }

      // Add year filter if provided
      if (yearFrom || yearTo) {
        const yearQuery = [];
        if (yearFrom) yearQuery.push(`submittedDate:[${yearFrom}01010000 TO *]`);
        if (yearTo) yearQuery.push(`submittedDate:[* TO ${yearTo}12312359]`);
        if (yearQuery.length > 0) {
          query = query ? `${query} AND (${yearQuery.join(' AND ')})` : yearQuery.join(' AND ');
        }
      }

      if (!query) {
        return { records: [] };
      }

      const response = await axios.get(this.baseUrl, {
        params: {
          search_query: query,
          start: Math.max(offset, 0),
          max_results: Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
          sortBy: 'relevance',
          sortOrder: 'descending'
        },
        headers: {
          'User-Agent': 'OpenAccessExplorer/1.0 (https://github.com/your-repo/open-access-explorer)'
        },
        timeout: 30000
      });
      log.debug(`arXiv response status: ${response.status}, data length: ${response.data.length}`);

      return new Promise((resolve, reject) => {
        parseString(response.data, (err, result) => {
          if (err) {
            log.error('arXiv XML parsing error:', err);
            reject(err);
            return;
          }
          log.debug('arXiv XML parsed successfully, entries:', result?.feed?.entry?.length || 0);

          try {
            const entries = result?.feed?.entry || [];
            const records: OARecord[] = entries.map((entry: any) => this.normalizeEntry(entry));
            const reported = Number(result?.feed?.['opensearch:totalResults']?.[0]?._ ??
                                    result?.feed?.['opensearch:totalResults']?.[0]);
            resolve({
              records,
              totalHits: Number.isFinite(reported) ? reported : undefined
            });
          } catch (error) {
            log.error('arXiv normalization error:', error);
            reject(error);
          }
        });
      });
    } catch (error) {
      log.error('arXiv search error:', error);
      log.error('arXiv error stack:', (error as Error).stack);
      return { records: [] };
    }
  }

  private normalizeEntry(entry: any): OARecord {
    const id = entry.id[0];
    const arxivId = id.split('/').pop();
    
    // Extract authors
    const authors = entry.author?.map((author: any) => author.name[0]) || [];
    
    // Extract PDF URL
    const links = entry.link || [];
    const pdfLink = links.find((link: any) => link.$.type === 'application/pdf');
    let pdfUrl = pdfLink?.$.href;
    
    // Ensure arXiv PDF URLs use HTTPS
    if (pdfUrl && pdfUrl.includes('arxiv.org')) {
      pdfUrl = pdfUrl.replace('http://', 'https://');
    }

    // Extract published date
    const published = entry.published?.[0];
    const year = published ? new Date(published).getFullYear() : undefined;

    return {
      id: `arxiv:${arxivId}`,
      title: entry.title[0].replace(/\s+/g, ' ').trim(),
      authors,
      year,
      abstract: entry.summary?.[0]?.replace(/\s+/g, ' ').trim(),
      source: 'arxiv',
      sourceId: arxivId || '',
      oaStatus: 'preprint',
      bestPdfUrl: pdfUrl,
      landingPage: id,
      topics: entry.category?.map((cat: any) => cat.$.term) || [],
      language: 'en',
      createdAt: published || new Date().toISOString(),
    };
  }
}
