import axios from 'axios';

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title: string;
  authorships: Array<{
    author: {
      display_name: string;
      orcid?: string;
    };
    institutions?: Array<{
      display_name: string;
    }>;
  }>;
  publication_year?: number;
  primary_location?: {
    source: {
      display_name: string;
      issn?: string[];
      publisher?: string;
    };
  };
  concepts: Array<{
    display_name: string;
    score: number;
  }>;
  abstract_inverted_index?: Record<string, number[]>;
  open_access?: {
    is_oa: boolean;
    oa_status?: string;
    oa_url?: string;
  };
  cited_by_count?: number;
  type: string;
  language?: string;
}

export interface OpenAlexResponse {
  results: OpenAlexWork[];
  meta: {
    count: number;
    page: number;
    per_page: number;
  };
}

export class OpenAlexClient {
  private baseUrl = 'https://api.openalex.org';
  private userAgent: string;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }

  async searchWorks(params: {
    query?: string;
    doi?: string;
    page?: number;
    perPage?: number;
    filter?: string;
  }): Promise<OpenAlexResponse> {
    const { query, doi, page = 1, perPage = 25, filter } = params;

    let searchQuery = '';
    if (doi) {
      searchQuery = `doi:${doi}`;
    } else if (query) {
      searchQuery = query;
    } else {
      throw new Error('Either query or doi must be provided');
    }

    const searchParams: any = {
      search: searchQuery,
      page,
      per_page: perPage,
      // Request only essential fields for performance
      select: 'id,doi,title,authorships,publication_year,primary_location,concepts,abstract_inverted_index,open_access,cited_by_count,type,language'
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

  async getWork(workId: string): Promise<OpenAlexWork> {
    const response = await axios.get(`${this.baseUrl}/works/${workId}`, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    return response.data;
  }

  async getWorkByDOI(doi: string): Promise<OpenAlexWork | null> {
    try {
      const response = await this.searchWorks({ doi, perPage: 1 });
      return response.results[0] || null;
    } catch (error) {
      console.error('OpenAlex DOI lookup error:', error);
      return null;
    }
  }

  // Helper method to reconstruct abstract from inverted index
  static reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    if (!invertedIndex) return '';
    
    const words: Array<{ word: string; position: number }> = [];
    
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const position of positions) {
        words.push({ word, position });
      }
    }
    
    words.sort((a, b) => a.position - b.position);
    return words.map(w => w.word).join(' ');
  }
}
