import axios, { AxiosInstance } from 'axios';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';
import { getPooledClient } from '../lib/http-client-factory';
import { getServiceConfig } from '../lib/http-pool-config';
import { log } from '../lib/logger';

/**
 * DataCite API Integration
 * Repository DOI registry and metadata
 * API Docs: https://support.datacite.org/docs/api
 */

// DataCite caps a single page at 1000 DOIs
const MAX_PAGE_SIZE = 1000;

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

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50, offset = 0 } = params;

    try {
      let query = '';

      if (doi) {
        query = `doi:${doi}`;
      } else if (titleOrKeywords) {
        query = `titles.title:*${titleOrKeywords}*`;
      } else {
        return { records: [] };
      }

      const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

      const searchParams: any = {
        'page[size]': pageSize,
        // Pages are 1-based, so an offset lands exactly on page boundaries
        'page[number]': Math.floor(Math.max(offset, 0) / pageSize) + 1,
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

      // The pooled client is configured not to throw below 500, so a rejected
      // or rate-limited request arrives here as a normal response carrying an
      // error body with no `data` array
      if (response.status >= 400 || !Array.isArray(response.data?.data)) {
        log.warn(`DataCite returned no usable payload (status ${response.status})`);
        return { records: [] };
      }

      const reported = Number(response.data.meta?.total);

      return {
        records: response.data.data.map(result => this.normalizeResult(result)),
        totalHits: Number.isFinite(reported) ? reported : undefined
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        log.error('DataCite search error:', error.message);
        if (error.response) {
          log.error('DataCite error status:', error.response.status);
          log.error('DataCite error data:', error.response.data);
        }
      } else {
        log.error('DataCite unexpected error:', error);
      }
      return { records: [] };
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
      record.publisher = attrs.publisher;
    }

    return record;
  }
}
