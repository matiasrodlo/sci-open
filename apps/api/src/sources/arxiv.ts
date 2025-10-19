import axios from 'axios';
import { parseString } from 'xml2js';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

export class ArxivConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://export.arxiv.org/api/query') {
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
        // For DOI, we can't search arXiv directly by DOI, so return empty
        return [];
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
        return [];
      }

      const response = await axios.get(this.baseUrl, {
        params: {
          search_query: query,
          start: 0,
          max_results: 50,
          sortBy: 'relevance',
          sortOrder: 'descending'
        },
        timeout: 5000
      });

      return new Promise((resolve, reject) => {
        parseString(response.data, (err, result) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            const entries = result?.feed?.entry || [];
            const records: OARecord[] = entries.map((entry: any) => this.normalizeEntry(entry));
            resolve(records);
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('arXiv search error:', error);
      return [];
    }
  }

  private normalizeEntry(entry: any): OARecord {
    const id = entry.id[0];
    const arxivId = id.split('/').pop()?.replace('v', '');
    
    // Extract authors
    const authors = entry.author?.map((author: any) => author.name[0]) || [];
    
    // Extract PDF URL
    const links = entry.link || [];
    const pdfLink = links.find((link: any) => link.$.type === 'application/pdf');
    const pdfUrl = pdfLink?.$.href;

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
