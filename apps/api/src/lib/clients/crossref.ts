import axios from 'axios';

export interface CrossrefWork {
  DOI: string;
  title: string[];
  author: Array<{
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
    affiliation?: Array<{
      name: string;
    }>;
  }>;
  'published-print'?: {
    'date-parts': number[][];
  };
  'published-online'?: {
    'date-parts': number[][];
  };
  publisher?: string;
  'container-title': string[];
  ISSN?: string[];
  abstract?: string;
  subject?: string[];
  language?: string;
  license?: Array<{
    URL: string;
    'content-version': string;
    'delay-in-days': number;
    start: {
      'date-parts': number[][];
    };
  }>;
  link?: Array<{
    URL: string;
    'content-type': string;
    'intended-application': string;
  }>;
  'reference-count'?: number;
  'is-referenced-by-count'?: number;
  'funder'?: Array<{
    name: string;
    'award': string[];
  }>;
}

export interface CrossrefResponse {
  'message-type': string;
  'message-version': string;
  message: {
    'total-results': number;
    'items-per-page': number;
    query: {
      'start-index': number;
      'search-terms': string;
    };
    'items': CrossrefWork[];
  };
}

export class CrossrefClient {
  private baseUrl = 'https://api.crossref.org';
  private userAgent: string;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }

  async searchWorks(params: {
    query?: string;
    doi?: string;
    rows?: number;
    offset?: number;
    sort?: string;
    order?: string;
    filter?: string;
  }): Promise<CrossrefResponse> {
    const { query, doi, rows = 20, offset = 0, sort = 'relevance', order = 'desc', filter } = params;

    let searchQuery = '';
    if (doi) {
      searchQuery = doi;
    } else if (query) {
      searchQuery = query;
    } else {
      throw new Error('Either query or doi must be provided');
    }

    const searchParams: any = {
      query: searchQuery,
      rows,
      offset,
      sort,
      order
    };

    if (filter) {
      searchParams.filter = filter;
    }

    const response = await axios.get(`${this.baseUrl}/works`, {
      params: searchParams,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    return response.data;
  }

  async getWork(doi: string): Promise<CrossrefWork | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/works/${encodeURIComponent(doi)}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      return response.data.message;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.error('Crossref work lookup error:', error);
      return null;
    }
  }

  // Helper method to extract publication year
  static extractYear(work: CrossrefWork): number | undefined {
    const publishedPrint = work['published-print']?.['date-parts']?.[0]?.[0];
    const publishedOnline = work['published-online']?.['date-parts']?.[0]?.[0];
    return publishedPrint || publishedOnline;
  }

  // Helper method to extract authors
  static extractAuthors(work: CrossrefWork): string[] {
    return work.author?.map(author => {
      if (author.name) {
        return author.name;
      }
      const given = author.given || '';
      const family = author.family || '';
      return `${given} ${family}`.trim();
    }) || [];
  }

  // Helper method to extract PDF link
  static extractPdfLink(work: CrossrefWork): string | undefined {
    return work.link?.find(link => 
      link['content-type'] === 'application/pdf' || 
      link['intended-application'] === 'text-mining'
    )?.URL;
  }

  // Helper method to extract license
  static extractLicense(work: CrossrefWork): string | undefined {
    const license = work.license?.[0];
    if (!license) return undefined;
    
    // Extract license type from URL
    const url = license.URL;
    if (url.includes('creativecommons.org')) {
      if (url.includes('by/4.0')) return 'CC-BY-4.0';
      if (url.includes('by-nc/4.0')) return 'CC-BY-NC-4.0';
      if (url.includes('by-sa/4.0')) return 'CC-BY-SA-4.0';
      if (url.includes('by-nd/4.0')) return 'CC-BY-ND-4.0';
      if (url.includes('by/3.0')) return 'CC-BY-3.0';
      if (url.includes('by-nc/3.0')) return 'CC-BY-NC-3.0';
    }
    
    return 'Custom License';
  }

  // Helper method to extract citation count
  static extractCitationCount(work: CrossrefWork): number | undefined {
    return work['is-referenced-by-count'];
  }
}
