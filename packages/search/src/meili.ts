import { MeiliSearch } from 'meilisearch';
import { SearchAdapter, OARecord } from '@open-access-explorer/shared';

export class MeilisearchAdapter implements SearchAdapter {
  private client: MeiliSearch;
  private indexName = 'oa_records';

  constructor(config: {
    host: string;
    apiKey: string;
  }) {
    this.client = new MeiliSearch({
      host: config.host,
      apiKey: config.apiKey,
    });
  }

  async ensureIndex(): Promise<void> {
    try {
      await this.client.getIndex(this.indexName);
    } catch (error) {
      // Index doesn't exist, create it
      const index = this.client.index(this.indexName);
      
      // Configure searchable attributes
      await index.updateSearchableAttributes([
        'title',
        'authors',
        'abstract'
      ]);

      // Configure filterable attributes
      await index.updateFilterableAttributes([
        'source',
        'oaStatus',
        'year',
        'venue',
        'topics'
      ]);

      // Configure sortable attributes
      await index.updateSortableAttributes([
        'year',
        'createdAt'
      ]);

      // Configure ranking rules
      await index.updateRankingRules([
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness'
      ]);
    }
  }

  async upsertMany(records: OARecord[]): Promise<void> {
    if (records.length === 0) return;
    
    try {
      const index = this.client.index(this.indexName);
      await index.addDocuments(records);
    } catch (error) {
      console.error('Error upserting records to Meilisearch:', error);
      throw error;
    }
  }

  async search(params: {
    q?: string;
    filters?: Record<string, string[] | number[]>;
    page?: number;
    pageSize?: number;
    sort?: "relevance" | "date" | "citations";
  }): Promise<{ hits: OARecord[]; total: number; facets: Record<string, any> }> {
    const {
      q = '',
      filters = {},
      page = 1,
      pageSize = 20,
      sort = 'relevance'
    } = params;

    const index = this.client.index(this.indexName);

    const searchParams: any = {
      q,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      facets: ['source', 'oaStatus', 'year', 'venue', 'topics', 'publisher'],
    };

    // Add filters
    const filter: string[] = [];
    Object.entries(filters).forEach(([key, values]) => {
      if (values && values.length > 0) {
        if (key === 'yearFrom' || key === 'yearTo') {
          // Handle year range
          if (key === 'yearFrom' && typeof values === 'number') {
            filter.push(`year >= ${values}`);
          } else if (key === 'yearTo' && typeof values === 'number') {
            filter.push(`year <= ${values}`);
          }
        } else {
          // Handle facet filters
          const valueList = Array.isArray(values) ? values : [values];
          filter.push(`${key} IN [${valueList.map(v => `"${v}"`).join(', ')}]`);
        }
      }
    });

    if (filter.length > 0) {
      searchParams.filter = filter.join(' AND ');
    }

    // Add sorting
    switch (sort) {
      case 'date':
        searchParams.sort = ['year:desc', 'createdAt:desc'];
        break;
      case 'citations':
        // Note: citations not available in our current schema
        searchParams.sort = ['createdAt:desc'];
        break;
      default:
        // relevance is default
        break;
    }

    try {
      const response = await index.search(searchParams);
      
      return {
        hits: (response.hits || []) as unknown as OARecord[],
        total: response.estimatedTotalHits || 0,
        facets: response.facetDistribution || {},
      };
    } catch (error) {
      console.error('Meilisearch search error:', error);
      throw error;
    }
  }
}
