import axios, { AxiosInstance } from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';
import { getPooledClient } from '../lib/http-client-factory';
import { getServiceConfig } from '../lib/http-pool-config';

/**
 * DataCite API Integration
 * Repository DOI registry and metadata
 * API Docs: https://support.datacite.org/docs/api
 */

interface DataCiteResult {
  id: string;
  type: string;
  attributes: {
    doi: string;
    titles: Array<{ title: string; titleType?: string }>;
    creators: Array<{
      name: string;
      nameType?: string;
      givenName?: string;
      familyName?: string;
    }>;
    publisher: string;
    publicationYear: number;
    descriptions?: Array<{ description: string; descriptionType?: string }>;
    subjects?: Array<{ subject: string; subjectScheme?: string }>;
    language?: string;
    url?: string;
    formats?: string[];
    sizes?: string[];
    version?: string;
    rightsList?: Array<{ rights: string; rightsUri?: string }>;
    dates?: Array<{ date: string; dateType: string }>;
    relatedIdentifiers?: Array<{
      relatedIdentifier: string;
      relatedIdentifierType: string;
      relationType: string;
    }>;
  };
  relationships?: {
    [key: string]: {
      data: Array<{ id: string; type: string }>;
    };
  };
}

interface DataCiteResponse {
  data: DataCiteResult[];
  meta: {
    total: number;
    totalPages: number;
    page: number;
  };
  links?: {
    self: string;
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}

export class DataCiteConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey?: string;
  private httpClient: AxiosInstance;

  constructor(baseUrl: string = 'https://api.datacite.org/dois', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    // Initialize pooled HTTP client with DataCite-specific configuration
    this.httpClient = getPooledClient(baseUrl, getServiceConfig('datacite'));
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;

    console.log('🔍 DataCite search called with params:', params);

    try {
      let query = '';
      
      if (doi) {
        query = `doi:${doi}`;
      } else if (titleOrKeywords) {
        query = `titles.title:*${titleOrKeywords}*`;
      } else {
        return [];
      }

      const searchParams: any = {
        'page[size]': 20,
        'page[number]': 1,
        query
      };

      if (yearFrom) {
        searchParams['publication-year'] = `${yearFrom}..${yearTo || new Date().getFullYear()}`;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await this.httpClient.get<DataCiteResponse>('', {
        params: searchParams,
        headers
      });
      
      console.log(`DataCite response status: ${response.status}, total: ${response.data.meta.total}, results count: ${response.data.data.length}`);
      if (response.data.data.length > 0) {
        console.log(`First DataCite result title: ${response.data.data[0].attributes.titles[0]?.title}`);
      }

      return response.data.data.map(result => this.normalizeResult(result));

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('DataCite search error:', error.message);
        if (error.response) {
          console.error('DataCite error status:', error.response.status);
          console.error('DataCite error data:', error.response.data);
        }
      } else {
        console.error('DataCite unexpected error:', error);
      }
      return [];
    }
  }

  private normalizeResult(result: DataCiteResult): OARecord {
    const attrs = result.attributes;
    
    // Extract title
    const title = attrs.titles?.[0]?.title || 'Untitled';
    
    // Extract authors
    const authors = attrs.creators?.map(creator => 
      creator.name || `${creator.givenName || ''} ${creator.familyName || ''}`.trim()
    ) || [];
    
    // Extract year
    const year = attrs.publicationYear;
    
    // Extract publisher/venue
    const venue = attrs.publisher || 'DataCite Repository';
    
    // Extract abstract
    const abstract = attrs.descriptions?.find(desc => 
      desc.descriptionType === 'Abstract' || !desc.descriptionType
    )?.description;
    
    // Extract DOI
    const doi = attrs.doi;
    
    // Extract topics/subjects
    const topics = attrs.subjects?.map(subject => subject.subject) || [];
    
    // Extract language
    const language = attrs.language || 'en';
    
    // Create landing page URL
    const landingPage = attrs.url || (doi ? `https://doi.org/${doi}` : undefined);
    
    // Determine OA status (DataCite typically contains repository items)
    const oaStatus: "preprint" | "accepted" | "published" | "other" = 
      attrs.relatedIdentifiers?.some(rel => rel.relationType === 'IsPublishedIn') 
        ? "published" 
        : "other";

    // Extract PDF URL from formats or related identifiers
    let bestPdfUrl: string | undefined;
    if (attrs.formats?.includes('application/pdf')) {
      bestPdfUrl = attrs.url;
    }

    const record: OARecord = {
      id: `datacite:${result.id}`,
      doi,
      title,
      authors,
      year,
      venue,
      abstract,
      source: 'datacite',
      sourceId: result.id,
      oaStatus,
      bestPdfUrl,
      landingPage,
      topics,
      language,
      createdAt: attrs.dates?.find(date => date.dateType === 'Created')?.date || new Date().toISOString(),
      updatedAt: attrs.dates?.find(date => date.dateType === 'Updated')?.date || undefined,
    };

    // Add publisher if available
    if (attrs.publisher) {
      (record as any).publisher = attrs.publisher;
    }

    return record;
  }
}
