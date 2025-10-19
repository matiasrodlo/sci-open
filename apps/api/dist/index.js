"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const search_1 = require("@open-access-explorer/search");
const arxiv_1 = require("./sources/arxiv");
const core_1 = require("./sources/core");
const europepmc_1 = require("./sources/europepmc");
const ncbi_1 = require("./sources/ncbi");
const pdf_1 = require("./lib/pdf");
const cache_1 = require("./lib/cache");
const fastify = (0, fastify_1.default)({
    logger: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
});
// Register plugins
fastify.register(cors_1.default, {
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
});
fastify.register(helmet_1.default);
// Initialize search adapter
let searchAdapter;
const searchBackend = process.env.SEARCH_BACKEND || 'typesense';
switch (searchBackend) {
    case 'typesense':
        searchAdapter = new search_1.TypesenseAdapter({
            host: process.env.TYPESENSE_HOST || 'localhost',
            port: parseInt(process.env.TYPESENSE_PORT || '8108'),
            protocol: process.env.TYPESENSE_PROTOCOL || 'http',
            apiKey: process.env.TYPESENSE_API_KEY || 'xyz'
        });
        break;
    case 'meili':
        searchAdapter = new search_1.MeilisearchAdapter({
            host: process.env.MEILI_HOST || 'http://localhost:7700',
            apiKey: process.env.MEILI_MASTER_KEY || 'xyz'
        });
        break;
    case 'algolia':
        searchAdapter = new search_1.AlgoliaAdapter({
            appId: process.env.ALGOLIA_APP_ID || '',
            apiKey: process.env.ALGOLIA_API_KEY || ''
        });
        break;
    default:
        throw new Error(`Unsupported search backend: ${searchBackend}`);
}
// Initialize source connectors
const arxivConnector = new arxiv_1.ArxivConnector(process.env.ARXIV_BASE);
const coreConnector = new core_1.CoreConnector(process.env.CORE_BASE, process.env.CORE_API_KEY || '');
const europepmcConnector = new europepmc_1.EuropePMCConnector(process.env.EUROPE_PMC_BASE);
const ncbiConnector = new ncbi_1.NCBIConnector(process.env.NCBI_EUTILS_BASE, process.env.NCBI_API_KEY);
// Ensure search index exists
searchAdapter.ensureIndex().catch(console.error);
// Search endpoint
fastify.post('/api/search', async (request, reply) => {
    try {
        const params = request.body;
        const cacheKey = (0, cache_1.generateCacheKey)('search', params);
        const searchCache = (0, cache_1.getSearchCache)();
        // Check cache first
        const cached = searchCache.get(cacheKey);
        if (cached) {
            reply.header('Cache-Control', 'public, max-age=300');
            return cached;
        }
        let searchResult = { hits: [], facets: {}, total: 0 };
        // Try search backend first, but gracefully handle failures
        try {
            searchResult = await searchAdapter.search({
                q: params.q,
                filters: params.filters,
                page: params.page || 1,
                pageSize: params.pageSize || 20,
                sort: params.sort || 'relevance'
            });
        }
        catch (searchError) {
            fastify.log.warn({ error: searchError }, 'Search backend unavailable, falling back to direct source queries');
            // Continue with empty search result - we'll query sources directly
        }
        // If no results from search backend or low recall, try remote sources
        if (searchResult.hits.length < 10 && (params.q || params.doi)) {
            fastify.log.info({ query: params.q || params.doi }, 'Querying remote sources');
            const remoteResults = await Promise.allSettled([
                arxivConnector.search(params),
                coreConnector.search(params),
                europepmcConnector.search(params),
                ncbiConnector.search(params)
            ]);
            const allRemoteResults = remoteResults
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => result.value);
            // Deduplicate by DOI and title
            const seen = new Set();
            const uniqueResults = allRemoteResults.filter(record => {
                const key = record.doi || record.title.toLowerCase();
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
            // Add to search index asynchronously (if backend is available)
            if (uniqueResults.length > 0) {
                searchAdapter.upsertMany(uniqueResults).catch((error) => {
                    fastify.log.warn({ error }, 'Failed to index results');
                });
            }
            // Use remote results as primary results
            searchResult.hits = uniqueResults.slice(0, params.pageSize || 20);
            searchResult.total = uniqueResults.length;
            // Generate basic facets from remote results
            searchResult.facets = {
                source: uniqueResults.reduce((acc, record) => {
                    acc[record.source] = (acc[record.source] || 0) + 1;
                    return acc;
                }, {}),
                year: uniqueResults.reduce((acc, record) => {
                    if (record.year) {
                        acc[record.year] = (acc[record.year] || 0) + 1;
                    }
                    return acc;
                }, {})
            };
        }
        const response = {
            hits: searchResult.hits,
            facets: searchResult.facets,
            page: params.page || 1,
            total: searchResult.total,
            pageSize: params.pageSize || 20
        };
        // Cache the result
        searchCache.set(cacheKey, response);
        reply.header('Cache-Control', 'public, max-age=300');
        return response;
    }
    catch (error) {
        fastify.log.error(error);
        reply.code(500);
        return { error: 'Internal server error' };
    }
});
// Paper endpoint
fastify.get('/api/paper/:id', async (request, reply) => {
    try {
        const { id } = request.params;
        const cacheKey = (0, cache_1.generateCacheKey)('paper', { id });
        const paperCache = (0, cache_1.getPaperCache)();
        // Check cache first
        const cached = paperCache.get(cacheKey);
        if (cached) {
            reply.header('Cache-Control', 'public, max-age=600');
            return cached;
        }
        // Try to find the record in search index first
        let record;
        try {
            const searchResult = await searchAdapter.search({
                q: `id:${id}`,
                pageSize: 1
            });
            record = searchResult.hits[0];
        }
        catch (error) {
            // If not found in index, try to reconstruct from source
            const [source, sourceId] = id.split(':');
            if (source && sourceId) {
                // This is a simplified approach - in production you might want to store more metadata
                record = {
                    id,
                    source,
                    sourceId,
                    title: 'Unknown',
                    authors: [],
                    createdAt: new Date().toISOString()
                };
            }
        }
        if (!record) {
            reply.code(404);
            return { error: 'Paper not found' };
        }
        // Resolve PDF URL
        const pdfUrl = await (0, pdf_1.resolveBestPdf)(record);
        const response = {
            record,
            pdf: {
                url: pdfUrl || undefined,
                status: pdfUrl ? 'ok' : 'not_found'
            }
        };
        // Cache the result
        paperCache.set(cacheKey, response);
        reply.header('Cache-Control', 'public, max-age=600');
        return response;
    }
    catch (error) {
        fastify.log.error(error);
        reply.code(500);
        return { error: 'Internal server error' };
    }
});
// Health check
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});
// Start server
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '4000');
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map