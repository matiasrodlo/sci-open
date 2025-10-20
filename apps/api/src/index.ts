import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from workspace root
// Handle both ESM (dev with tsx) and CommonJS (production build)
let __dirname_esm: string;
if (typeof __dirname === 'undefined') {
  const __filename_esm = fileURLToPath(import.meta.url);
  __dirname_esm = path.dirname(__filename_esm);
} else {
  __dirname_esm = __dirname;
}
dotenv.config({ path: path.resolve(__dirname_esm, '../../../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { SearchParams, SearchResponse, PaperResponse, OARecord } from '@open-access-explorer/shared';
import { SearchPipeline } from './lib/search-pipeline';
import { resolveBestPdf } from './lib/pdf';
import { getSearchCache, getPaperCache, generateCacheKey } from './lib/cache';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  }
});

// Register plugins
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
});

fastify.register(helmet);

// Initialize search pipeline
const userAgent = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'your-email@example.com'})`;
const searchPipeline = new SearchPipeline({
  userAgent,
  maxResults: 100,
  enableEnrichment: true,
  enablePdfResolution: true,
  enableCitations: false
});

// Search endpoint
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  try {
    const params = request.body;
    const cacheKey = generateCacheKey('search', params);
    const searchCache = getSearchCache();
    
    // Check cache first
    const cached = searchCache.get<SearchResponse>(cacheKey);
    if (cached) {
      fastify.log.info({ cacheKey, query: params.q }, 'Returning cached search results');
      reply.header('Cache-Control', 'public, max-age=300');
      return cached;
    }
    
    fastify.log.info({ cacheKey, query: params.q }, 'No cache hit, performing fresh search');

    // Use the new search pipeline
    const searchResult = await searchPipeline.search(params);

    // Cache the result
    searchCache.set(cacheKey, searchResult, 300000); // 5 minutes
    reply.header('Cache-Control', 'public, max-age=300');
    
    fastify.log.info({ 
      totalResults: searchResult.total,
      query: params.q 
    }, 'Search pipeline completed');
    
    return searchResult;

  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Paper details endpoint
fastify.get<{ Params: { id: string } }>('/api/paper/:id', async (request, reply) => {
  try {
    const { id } = request.params;
    const cacheKey = generateCacheKey('paper', { id });
    const paperCache = getPaperCache();
    
    // Check cache first
    const cached = paperCache.get<PaperResponse>(cacheKey);
    if (cached) {
      fastify.log.info({ cacheKey, id }, 'Returning cached paper details');
      reply.header('Cache-Control', 'public, max-age=600');
      return cached;
    }
    
    fastify.log.info({ cacheKey, id }, 'No cache hit, resolving paper details');

    // Resolve PDF URL
    const pdfResult = await resolveBestPdf(id);
    
    const response: PaperResponse = {
      record: {
        id,
        title: 'Paper Details',
        authors: [],
        source: 'unknown',
        sourceId: id,
        createdAt: new Date().toISOString()
      },
      pdf: pdfResult
    };

    // Cache the result
    paperCache.set(cacheKey, response, 600000); // 10 minutes
    reply.header('Cache-Control', 'public, max-age=600');
    
    fastify.log.info({ id, pdfStatus: pdfResult.status }, 'Paper details resolved');
    
    return response;

  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
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
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Debug endpoint for testing aggregators
fastify.get('/debug/aggregators', async (request, reply) => {
  try {
    const { AggregatorManager } = await import('./lib/aggregators');
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
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
