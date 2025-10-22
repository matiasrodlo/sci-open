"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
// Load .env from workspace root
// Handle both ESM (dev with tsx) and CommonJS (production build)
let __dirname_esm;
if (typeof __dirname === 'undefined') {
    const __filename_esm = (0, url_1.fileURLToPath)(import.meta.url);
    __dirname_esm = path_1.default.dirname(__filename_esm);
}
else {
    __dirname_esm = __dirname;
}
dotenv_1.default.config({ path: path_1.default.resolve(__dirname_esm, '../../../.env') });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const search_pipeline_1 = require("./lib/search-pipeline");
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
// Initialize search pipeline
const userAgent = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'your-email@example.com'})`;
const searchPipeline = new search_pipeline_1.SearchPipeline({
    userAgent,
    maxResults: 100,
    enableEnrichment: true,
    enablePdfResolution: true,
    enableCitations: false
});
// Search endpoint with advanced caching
fastify.post('/api/search', async (request, reply) => {
    const startTime = Date.now();
    try {
        const params = request.body;
        // Record query usage for cache warming
        if (params.q) {
            await cache_1.cacheWarmer.recordQueryUsage(params.q);
        }
        // Check advanced cache first
        const cached = await cache_1.searchCacheManager.getCachedSearchResults(params.q || '', params);
        if (cached) {
            const responseTime = Date.now() - startTime;
            fastify.log.info({
                query: params.q,
                responseTime,
                totalResults: cached.total
            }, 'Returning cached search results');
            reply.header('Cache-Control', 'public, max-age=300');
            reply.header('X-Cache-Hit', 'true');
            reply.header('X-Response-Time', responseTime.toString());
            return cached;
        }
        // Check for similar cached results
        const similarCached = await cache_1.searchCacheManager.getSimilarResults(params.q || '', params);
        if (similarCached) {
            const responseTime = Date.now() - startTime;
            fastify.log.info({
                query: params.q,
                responseTime,
                totalResults: similarCached.total
            }, 'Returning similar cached search results');
            reply.header('Cache-Control', 'public, max-age=300');
            reply.header('X-Cache-Hit', 'similar');
            reply.header('X-Response-Time', responseTime.toString());
            return similarCached;
        }
        fastify.log.info({ query: params.q }, 'No cache hit, performing fresh search');
        // Use the search pipeline
        const searchResult = await searchPipeline.search(params);
        // Cache the result using advanced cache manager
        await cache_1.searchCacheManager.cacheSearchResults(params.q || '', params, searchResult);
        // Cache facets separately for better performance
        if (searchResult.facets) {
            await cache_1.searchCacheManager.cacheFacets(params.q || '', params, searchResult.facets);
        }
        const responseTime = Date.now() - startTime;
        reply.header('Cache-Control', 'public, max-age=300');
        reply.header('X-Cache-Hit', 'false');
        reply.header('X-Response-Time', responseTime.toString());
        fastify.log.info({
            totalResults: searchResult.total,
            query: params.q,
            responseTime
        }, 'Search pipeline completed');
        return searchResult;
    }
    catch (error) {
        const responseTime = Date.now() - startTime;
        fastify.log.error({
            error: error.message,
            query: params.q,
            responseTime
        }, 'Search error');
        reply.code(500);
        return { error: error.message };
    }
});
// Paper details endpoint with advanced caching
fastify.get('/api/paper/:id', async (request, reply) => {
    const startTime = Date.now();
    try {
        const { id } = request.params;
        // Record paper access for cache warming
        await cache_1.cacheWarmer.recordPaperAccess(id, 'Unknown Title');
        // Check advanced cache first
        const cached = await cache_1.paperCacheManager.getCachedPaper(id);
        if (cached) {
            const responseTime = Date.now() - startTime;
            fastify.log.info({
                id,
                responseTime,
                title: cached.title
            }, 'Returning cached paper details');
            reply.header('Cache-Control', 'public, max-age=600');
            reply.header('X-Cache-Hit', 'true');
            reply.header('X-Response-Time', responseTime.toString());
            return cached;
        }
        // Try to get by DOI if ID looks like a DOI
        if (id.includes('10.')) {
            const cachedByDoi = await cache_1.paperCacheManager.getCachedPaperByDoi(id);
            if (cachedByDoi) {
                const responseTime = Date.now() - startTime;
                fastify.log.info({
                    id,
                    responseTime,
                    title: cachedByDoi.title
                }, 'Returning cached paper details by DOI');
                reply.header('Cache-Control', 'public, max-age=600');
                reply.header('X-Cache-Hit', 'doi');
                reply.header('X-Response-Time', responseTime.toString());
                return cachedByDoi;
            }
        }
        fastify.log.info({ id }, 'No cache hit, fetching paper details');
        // Parse the ID to extract source and sourceId
        // ID format: source:sourceId or just sourceId
        let source;
        let sourceId = id;
        if (id.includes(':')) {
            const parts = id.split(':');
            source = parts[0];
            sourceId = parts.slice(1).join(':');
        }
        // Try to fetch from the appropriate source
        let paper = null;
        if (source === 'arxiv' || (!source && sourceId.match(/^\d{4}\.\d{4,5}(v\d+)?$/))) {
            const { ArxivConnector } = await Promise.resolve().then(() => __importStar(require('./sources/arxiv')));
            const arxivConnector = new ArxivConnector();
            const results = await arxivConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'core') {
            const { COREConnector } = await Promise.resolve().then(() => __importStar(require('./sources/core')));
            const coreConnector = new COREConnector();
            const results = await coreConnector.search({ q: `id:${sourceId}`, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'europepmc') {
            const { EuropePMCConnector } = await Promise.resolve().then(() => __importStar(require('./sources/europepmc')));
            const pmcConnector = new EuropePMCConnector();
            const results = await pmcConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'ncbi') {
            const { NCBIConnector } = await Promise.resolve().then(() => __importStar(require('./sources/ncbi')));
            const ncbiConnector = new NCBIConnector();
            const results = await ncbiConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'openaire') {
            const { OpenAIREConnector } = await Promise.resolve().then(() => __importStar(require('./sources/openaire')));
            const openaireConnector = new OpenAIREConnector();
            const results = await openaireConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'biorxiv' || source === 'medrxiv') {
            const { BiorxivConnector } = await Promise.resolve().then(() => __importStar(require('./sources/biorxiv')));
            const biorxivConnector = new BiorxivConnector();
            const results = await biorxivConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'doaj') {
            const { DOAJConnector } = await Promise.resolve().then(() => __importStar(require('./sources/doaj')));
            const doajConnector = new DOAJConnector();
            const results = await doajConnector.search({ q: sourceId, page: 1, pageSize: 1 });
            paper = results[0] || null;
        }
        else if (source === 'openalex') {
            // Handle OpenAlex works directly via API
            try {
                const { OpenAlexClient } = await Promise.resolve().then(() => __importStar(require('./lib/clients/openalex')));
                const openalexClient = new OpenAlexClient(userAgent);
                const work = await openalexClient.getWork(sourceId);
                // Convert OpenAlex work to OARecord format
                paper = {
                    id: work.id,
                    title: work.title,
                    authors: work.authorships?.map(a => a.author.display_name) || [],
                    abstract: work.abstract_inverted_index ?
                        Object.entries(work.abstract_inverted_index)
                            .sort(([, a], [, b]) => a[0] - b[0])
                            .map(([word]) => word)
                            .join(' ') : undefined,
                    doi: work.doi,
                    year: work.publication_year,
                    venue: work.primary_location?.source?.display_name,
                    topics: work.concepts?.map(c => c.display_name) || [],
                    citationCount: work.cited_by_count,
                    oaStatus: work.open_access?.is_oa ? 'published' : undefined,
                    bestPdfUrl: work.open_access?.oa_url,
                    landingPage: work.id,
                    source: 'openalex',
                    language: work.language || 'en'
                };
            }
            catch (error) {
                console.error('OpenAlex fetch error:', error);
                paper = null;
            }
        }
        // If no paper found, return 404
        if (!paper) {
            reply.code(404);
            return { error: 'Paper not found' };
        }
        // Cache the result using advanced cache manager
        await cache_1.paperCacheManager.cachePaperDetails(paper);
        const responseTime = Date.now() - startTime;
        reply.header('Cache-Control', 'public, max-age=600');
        reply.header('X-Cache-Hit', 'false');
        reply.header('X-Response-Time', responseTime.toString());
        fastify.log.info({
            id,
            title: paper.title,
            responseTime
        }, 'Paper details fetched and cached');
        return paper;
    }
    catch (error) {
        fastify.log.error({ error: error.message }, 'Error fetching paper details');
        reply.code(500);
        return { error: error.message };
    }
});
// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});
// Cache metrics endpoint
fastify.get('/api/cache/metrics', async (request, reply) => {
    try {
        const metrics = cache_1.cacheManager.getMetrics();
        const warmingStats = cache_1.cacheWarmer.getWarmingStats();
        return {
            cache: metrics,
            warming: warmingStats,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        reply.code(500);
        return { error: error.message };
    }
});
// Cache warming endpoint
fastify.post('/api/cache/warm', async (request, reply) => {
    try {
        await cache_1.cacheWarmer.startWarming();
        return {
            message: 'Cache warming started',
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        reply.code(500);
        return { error: error.message };
    }
});
// Cache clear endpoint
fastify.post('/api/cache/clear', async (request, reply) => {
    try {
        await cache_1.cacheManager.clear();
        return {
            message: 'Cache cleared',
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        reply.code(500);
        return { error: error.message };
    }
});
// Debug endpoint for testing sources
fastify.get('/debug/sources', async (request, reply) => {
    try {
        const testParams = { titleOrKeywords: 'ai' };
        // Test the search pipeline
        const result = await searchPipeline.search({
            q: 'ai',
            page: 1,
            pageSize: 5
        });
        return {
            status: 'ok',
            sources: Object.keys(result.facets.source || {}),
            totalResults: result.total,
            sampleResults: result.hits.slice(0, 3).map(hit => ({
                id: hit.id,
                title: hit.title,
                source: hit.source,
                doi: hit.doi
            }))
        };
    }
    catch (error) {
        reply.code(500);
        return { error: error.message };
    }
});
// Debug endpoint for testing aggregators
fastify.get('/debug/aggregators', async (request, reply) => {
    try {
        const { AggregatorManager } = await Promise.resolve().then(() => __importStar(require('./lib/aggregators')));
        const aggregatorManager = new AggregatorManager();
        // Test aggregator search
        const aggregatorResults = await aggregatorManager.searchAggregators({
            q: 'machine learning',
            page: 1,
            pageSize: 3
        });
        // Get aggregator stats
        const stats = aggregatorManager.getAggregatorStats();
        return {
            status: 'ok',
            aggregators: stats,
            results: aggregatorResults.map(result => ({
                source: result.source,
                recordCount: result.records.length,
                latency: result.latency,
                error: result.error,
                sampleRecord: result.records[0] ? {
                    id: result.records[0].id,
                    title: result.records[0].title,
                    doi: result.records[0].doi
                } : null
            }))
        };
    }
    catch (error) {
        reply.code(500);
        return { error: error.message };
    }
});
// Start server with cache warming
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '4000');
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
        // Start cache warming in background
        console.log('Starting cache warming...');
        cache_1.cacheWarmer.startWarming().catch(err => {
            console.error('Cache warming failed:', err);
        });
        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('Shutting down gracefully...');
            await cache_1.cacheManager.close();
            await fastify.close();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            console.log('Shutting down gracefully...');
            await cache_1.cacheManager.close();
            await fastify.close();
            process.exit(0);
        });
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map