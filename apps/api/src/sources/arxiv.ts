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
    console.log('🔍 arXiv search called with params:', params);
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

      console.log(`arXiv searching for: ${query}`);
      const url = `${this.baseUrl}?search_query=${encodeURIComponent(query)}&start=0&max_results=50&sortBy=relevance&sortOrder=descending`;
      console.log(`arXiv full URL: ${url}`);
      const response = await axios.get(this.baseUrl, {
        params: {
          search_query: query,
          start: 0,
          max_results: 50,
          sortBy: 'relevance',
          sortOrder: 'descending'
        },
        headers: {
          'User-Agent': 'OpenAccessExplorer/1.0 (https://github.com/your-repo/open-access-explorer)'
        },
        timeout: 30000
      });
      console.log(`arXiv response status: ${response.status}, data length: ${response.data.length}`);
      console.log(`arXiv response preview: ${response.data.substring(0, 200)}...`);

      return new Promise((resolve, reject) => {
        parseString(response.data, (err, result) => {
          if (err) {
            console.error('arXiv XML parsing error:', err);
            reject(err);
            return;
          }
          console.log('arXiv XML parsed successfully, entries:', result?.feed?.entry?.length || 0);
          console.log('arXiv XML structure:', JSON.stringify(result?.feed, null, 2).substring(0, 500));

          try {
            const entries = result?.feed?.entry || [];
            console.log(`arXiv processing ${entries.length} entries`);
            const records: OARecord[] = entries.map((entry: any) => this.normalizeEntry(entry));
            console.log(`arXiv normalized ${records.length} records`);
            resolve(records);
          } catch (error) {
            console.error('arXiv normalization error:', error);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('arXiv search error:', error);
      console.error('arXiv error stack:', (error as Error).stack);
      return [];
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
