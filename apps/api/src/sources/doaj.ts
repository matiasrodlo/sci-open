import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

interface DOAJArticle {
  id: string;
  created_date: string;
  last_updated: string;
  bibjson: {
    title: string;
    author: Array<{
      name: string;
      affiliation?: string[];
    }>;
    year: string;
    journal: {
      title: string;
      issn?: string[];
      publisher?: string;
    };
    abstract?: string;
    identifier?: Array<{
      type: string;
      id: string;
    }>;
    link?: Array<{
      type: string;
      content_type: string;
      url: string;
    }>;
    keywords?: string[];
    subject?: Array<{
      scheme: string;
      term: string;
    }>;
  };
}

interface DOAJResponse {
  total: number;
  page: number;
  pageSize: number;
  results: DOAJArticle[];
}

export class DOAJConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = 'https://doaj.org/api', apiKey?: string) {
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

    console.log('🔍 DOAJ search called with params:', params);

    try {
      let query = '';
      
      if (doi) {
        query = `doi:${doi}`;
      } else if (titleOrKeywords) {
        // DOAJ supports various search fields
        query = `title:${titleOrKeywords} OR abstract:${titleOrKeywords} OR keywords:${titleOrKeywords}`;
      } else {
        return [];
      }

      // Add year filters if provided
      if (yearFrom || yearTo) {
        const yearQuery = [];
        if (yearFrom) yearQuery.push(`year:[${yearFrom} TO *]`);
        if (yearTo) yearQuery.push(`year:[* TO ${yearTo}]`);
        if (yearQuery.length > 0) {
          query += ` AND (${yearQuery.join(' OR ')})`;
        }
      }

      console.log(`DOAJ searching for: ${query}`);

      const searchParams: any = {
        q: query,
        pageSize: 50,
        page: 1,
        sort: 'created_date:desc'
      };

      const headers: any = {
        'User-Agent': 'OpenAccessExplorer/1.0 (https://github.com/your-repo/open-access-explorer)',
        'Accept': 'application/json'
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await axios.get(`${this.baseUrl}/search/articles/${encodeURIComponent(query)}`, {
        params: searchParams,
        headers,
        timeout: 15000
      });

      console.log(`DOAJ response status: ${response.status}, results: ${response.data?.results?.length || 0}`);

      if (!response.data?.results) {
        return [];
      }

      const records: OARecord[] = response.data.results.map((article: DOAJArticle) => 
        this.normalizeArticle(article)
      );

      console.log(`DOAJ normalized ${records.length} records`);
      return records;

    } catch (error) {
      console.error('DOAJ search error:', error);
      if (axios.isAxiosError(error)) {
        console.error('DOAJ error status:', error.response?.status);
        console.error('DOAJ error data:', error.response?.data);
      }
      return [];
    }
  }

  private normalizeArticle(article: DOAJArticle): OARecord {
    const bibjson = article.bibjson;
    
    // Extract title
    const title = bibjson.title || 'Untitled';
    
    // Extract authors
    const authors = bibjson.author?.map(author => author.name) || [];
    
    // Extract year
    const year = bibjson.year ? parseInt(bibjson.year) : undefined;
    
    // Extract journal/venue
    const venue = bibjson.journal?.title || 'DOAJ Journal';
    
    // Extract abstract
    const abstract = bibjson.abstract;
    
    // Extract DOI from identifiers
    const doiIdentifier = bibjson.identifier?.find(id => id.type === 'doi');
    const doi = doiIdentifier?.id;
    
    // Extract keywords/topics
    const topics = bibjson.keywords || [];
    
    // Extract fulltext URL from links
    const fulltextLink = bibjson.link?.find(link => 
      link.type === 'fulltext' || link.content_type === 'application/pdf'
    );
    const fulltextUrl = fulltextLink?.url;
    
    // Create landing page URL
    const landingPage = doi ? `https://doi.org/${doi}` : `https://doaj.org/article/${article.id}`;
    
    // Determine OA status (DOAJ articles are all published open access)
    const oaStatus: "preprint" | "accepted" | "published" | "other" = "published";

    return {
      id: `doaj:${article.id}`,
      doi,
      title,
      authors,
      year,
      venue,
      abstract,
      source: 'doaj',
      sourceId: article.id,
      oaStatus,
      bestPdfUrl: fulltextUrl,
      landingPage,
      topics,
      language: 'en', // DOAJ doesn't provide language info in this format
      createdAt: article.created_date || new Date().toISOString(),
      updatedAt: article.last_updated || undefined,
    };
  }
}
