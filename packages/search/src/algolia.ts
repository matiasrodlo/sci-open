import algoliasearch, { SearchClient, SearchIndex } from 'algoliasearch';
import { SearchAdapter, OARecord } from '@open-access-explorer/shared';

export class AlgoliaAdapter implements SearchAdapter {
  private client: SearchClient;
  private index: SearchIndex;
  private indexName = 'oa_records';

  constructor(config: {
    appId: string;
    apiKey: string;
  }) {
    this.client = algoliasearch(config.appId, config.apiKey);
    this.index = this.client.initIndex(this.indexName);
  }

  async ensureIndex(): Promise<void> {
    try {
      // Configure index settings
      await this.index.setSettings({
        searchableAttributes: [
          'title',
          'authors',
          'abstract'
        ],
        attributesForFaceting: [
          'searchable(source)',
          'searchable(oaStatus)',
          'searchable(venue)',
          'searchable(topics)',
          'year'
        ],
        attributesToRetrieve: [
          'id',
          'doi',
          'title',
          'authors',
          'year',
          'venue',
          'abstract',
          'source',
          'sourceId',
          'oaStatus',
          'bestPdfUrl',
          'landingPage',
          'topics',
          'language',
          'createdAt',
          'updatedAt'
        ],
        ranking: [
          'typo',
          'geo',
          'words',
          'filters',
          'proximity',
          'attribute',
          'exact',
          'custom'
        ],
        customRanking: [
          'desc(createdAt)'
        ]
      });
    } catch (error) {
      console.error('Error configuring Algolia index:', error);
      throw error;
    }
  }

  async upsertMany(records: OARecord[]): Promise<void> {
    if (records.length === 0) return;
    
    try {
      await this.index.saveObjects(records);
    } catch (error) {
      console.error('Error upserting records to Algolia:', error);
      throw error;
    }
  }

  async search(params: {
    q?: string;
    filters?: Record<string, string[] | number[]>;
    page?: number;
    pageSize?: number;
    sort?: "relevance" | "date" | "date_asc" | "citations" | "citations_asc" | "author" | "author_desc" | "venue" | "venue_desc" | "title" | "title_desc";
  }): Promise<{ hits: OARecord[]; total: number; facets: Record<string, any> }> {
    const {
      q = '',
      filters = {},
      page = 1,
      pageSize = 20,
      sort = 'relevance'
    } = params;

    const searchParams: any = {
      query: q,
      hitsPerPage: pageSize,
      page: page - 1, // Algolia uses 0-based pagination
      facets: ['source', 'oaStatus', 'venue', 'topics', 'year', 'publisher'],
      maxValuesPerFacet: 100,
    };

    // Add filters
    const facetFilters: string[] = [];
    Object.entries(filters).forEach(([key, values]) => {
      if (values && values.length > 0) {
        if (key === 'yearFrom' || key === 'yearTo') {
          // Handle year range
          if (key === 'yearFrom' && typeof values === 'number') {
            searchParams.numericFilters = searchParams.numericFilters || [];
            searchParams.numericFilters.push(`year >= ${values}`);
          } else if (key === 'yearTo' && typeof values === 'number') {
            searchParams.numericFilters = searchParams.numericFilters || [];
            searchParams.numericFilters.push(`year <= ${values}`);
          }
        } else {
          // Handle facet filters
          const valueList = Array.isArray(values) ? values : [values];
          facetFilters.push(`${key}:${valueList.join(` OR ${key}:`)}`);
        }
      }
    });

    if (facetFilters.length > 0) {
      searchParams.facetFilters = facetFilters;
    }

    // Add sorting
    switch (sort) {
      case 'date':
        searchParams.customRanking = ['desc(year)', 'desc(createdAt)'];
        break;
      case 'date_asc':
        searchParams.customRanking = ['asc(year)', 'desc(createdAt)'];
        break;
      case 'citations':
        // Note: citations not available in our current schema
        searchParams.customRanking = ['desc(createdAt)'];
        break;
      case 'citations_asc':
        // Note: citations not available in our current schema
        searchParams.customRanking = ['desc(createdAt)'];
        break;
      case 'author':
        searchParams.customRanking = ['asc(authors)', 'desc(createdAt)'];
        break;
      case 'author_desc':
        searchParams.customRanking = ['desc(authors)', 'desc(createdAt)'];
        break;
      case 'venue':
        searchParams.customRanking = ['asc(venue)', 'desc(createdAt)'];
        break;
      case 'venue_desc':
        searchParams.customRanking = ['desc(venue)', 'desc(createdAt)'];
        break;
      case 'title':
        searchParams.customRanking = ['asc(title)', 'desc(createdAt)'];
        break;
      case 'title_desc':
        searchParams.customRanking = ['desc(title)', 'desc(createdAt)'];
        break;
      default:
        // relevance is default
        break;
    }

    try {
      const response = await this.index.search(searchParams);
      
      return {
        hits: (response.hits || []) as unknown as OARecord[],
        total: response.nbHits || 0,
        facets: response.facets || {},
      };
    } catch (error) {
      console.error('Algolia search error:', error);
      throw error;
    }
  }
}
