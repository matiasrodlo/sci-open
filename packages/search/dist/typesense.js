"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypesenseAdapter = void 0;
const typesense_1 = require("typesense");
class TypesenseAdapter {
    constructor(config) {
        this.collectionName = 'oa_records';
        this.client = new typesense_1.Client({
            nodes: [{
                    host: config.host,
                    port: config.port,
                    protocol: config.protocol,
                }],
            apiKey: config.apiKey,
            connectionTimeoutSeconds: 2,
        });
    }
    async ensureIndex() {
        try {
            await this.client.collections(this.collectionName).retrieve();
        }
        catch (error) {
            // Collection doesn't exist, create it
            await this.client.collections().create({
                name: this.collectionName,
                fields: [
                    { name: 'id', type: 'string' },
                    { name: 'doi', type: 'string', optional: true },
                    { name: 'title', type: 'string' },
                    { name: 'authors', type: 'string[]' },
                    { name: 'year', type: 'int32', optional: true, facet: true },
                    { name: 'venue', type: 'string', optional: true, facet: true },
                    { name: 'abstract', type: 'string', optional: true },
                    { name: 'source', type: 'string', facet: true },
                    { name: 'sourceId', type: 'string' },
                    { name: 'oaStatus', type: 'string', optional: true, facet: true },
                    { name: 'bestPdfUrl', type: 'string', optional: true },
                    { name: 'landingPage', type: 'string', optional: true },
                    { name: 'topics', type: 'string[]', optional: true, facet: true },
                    { name: 'language', type: 'string', optional: true },
                    { name: 'createdAt', type: 'string' },
                    { name: 'updatedAt', type: 'string', optional: true },
                ],
                default_sorting_field: 'createdAt',
            });
        }
    }
    async upsertMany(records) {
        if (records.length === 0)
            return;
        try {
            await this.client.collections(this.collectionName).documents().import(records);
        }
        catch (error) {
            console.error('Error upserting records to Typesense:', error);
            throw error;
        }
    }
    async search(params) {
        const { q = '*', filters = {}, page = 1, pageSize = 20, sort = 'relevance' } = params;
        const searchParams = {
            q,
            query_by: 'title,authors,abstract',
            per_page: pageSize,
            page,
            facet_by: 'source,oaStatus,year,venue,topics,publisher',
            max_facet_values: 100,
        };
        // Add filters
        const filterBy = [];
        Object.entries(filters).forEach(([key, values]) => {
            if (values && values.length > 0) {
                if (key === 'yearFrom' || key === 'yearTo') {
                    // Handle year range
                    if (key === 'yearFrom' && typeof values === 'number') {
                        filterBy.push(`year:>=${values}`);
                    }
                    else if (key === 'yearTo' && typeof values === 'number') {
                        filterBy.push(`year:<=${values}`);
                    }
                }
                else {
                    // Handle facet filters
                    const valueList = Array.isArray(values) ? values : [values];
                    filterBy.push(`${key}:=${valueList.join(',')}`);
                }
            }
        });
        if (filterBy.length > 0) {
            searchParams.filter_by = filterBy.join(' && ');
        }
        // Add sorting
        switch (sort) {
            case 'date':
                searchParams.sort_by = 'year:desc,createdAt:desc';
                break;
            case 'date_asc':
                searchParams.sort_by = 'year:asc,createdAt:desc';
                break;
            case 'citations':
                // Note: citations not available in our current schema
                searchParams.sort_by = 'createdAt:desc';
                break;
            case 'citations_asc':
                // Note: citations not available in our current schema
                searchParams.sort_by = 'createdAt:desc';
                break;
            case 'author':
                searchParams.sort_by = 'authors:asc,createdAt:desc';
                break;
            case 'author_desc':
                searchParams.sort_by = 'authors:desc,createdAt:desc';
                break;
            case 'venue':
                searchParams.sort_by = 'venue:asc,createdAt:desc';
                break;
            case 'venue_desc':
                searchParams.sort_by = 'venue:desc,createdAt:desc';
                break;
            case 'title':
                searchParams.sort_by = 'title:asc,createdAt:desc';
                break;
            case 'title_desc':
                searchParams.sort_by = 'title:desc,createdAt:desc';
                break;
            default:
                // relevance is default
                break;
        }
        try {
            const response = await this.client.collections(this.collectionName).documents().search(searchParams);
            return {
                hits: response.hits?.map((hit) => hit.document) || [],
                total: response.found || 0,
                facets: response.facet_counts || {},
            };
        }
        catch (error) {
            console.error('Typesense search error:', error);
            throw error;
        }
    }
}
exports.TypesenseAdapter = TypesenseAdapter;
//# sourceMappingURL=typesense.js.map