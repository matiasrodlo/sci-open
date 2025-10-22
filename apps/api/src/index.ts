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
import { SearchParams, SearchResponse, OARecord } from '@open-access-explorer/shared';
import { SearchPipeline } from './lib/search-pipeline';
import { 
  getSearchCache, 
  getPaperCache, 
  generateCacheKey,
  searchCacheManager,
  paperCacheManager,
  cacheWarmer,
  cacheManager
} from './lib/cache';

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

// Search endpoint with advanced caching
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    const params = request.body;
    
    // Record query usage for cache warming
    if (params.q) {
      await cacheWarmer.recordQueryUsage(params.q);
    }
    
    // Check advanced cache first
    const cached = await searchCacheManager.getCachedSearchResults(params.q || '', params);
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
    const similarCached = await searchCacheManager.getSimilarResults(params.q || '', params);
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
    await searchCacheManager.cacheSearchResults(params.q || '', params, searchResult);
    
    // Cache facets separately for better performance
    if (searchResult.facets) {
      await searchCacheManager.cacheFacets(params.q || '', params, searchResult.facets);
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

  } catch (error: any) {
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
fastify.get<{ Params: { id: string } }>('/api/paper/:id', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    const { id } = request.params;
    
    // Record paper access for cache warming
    await cacheWarmer.recordPaperAccess(id, 'Unknown Title');
    
    // Check advanced cache first
    const cached = await paperCacheManager.getCachedPaper(id);
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
      const cachedByDoi = await paperCacheManager.getCachedPaperByDoi(id);
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
    let source: string | undefined;
    let sourceId: string = id;
    
    if (id.includes(':')) {
      const parts = id.split(':');
      source = parts[0];
      sourceId = parts.slice(1).join(':');
    }

    // Try to fetch from the appropriate source
    let paper: OARecord | null = null;

    if (source === 'arxiv' || (!source && sourceId.match(/^\d{4}\.\d{4,5}(v\d+)?$/))) {
      const { ArxivConnector } = await import('./sources/arxiv');
      const arxivConnector = new ArxivConnector();
      const results = await arxivConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'core') {
      const { COREConnector } = await import('./sources/core');
      const coreConnector = new COREConnector();
      const results = await coreConnector.search({ q: `id:${sourceId}`, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'europepmc') {
      const { EuropePMCConnector } = await import('./sources/europepmc');
      const pmcConnector = new EuropePMCConnector();
      const results = await pmcConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'ncbi') {
      const { NCBIConnector } = await import('./sources/ncbi');
      const ncbiConnector = new NCBIConnector();
      const results = await ncbiConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'openaire') {
      const { OpenAIREConnector } = await import('./sources/openaire');
      const openaireConnector = new OpenAIREConnector();
      const results = await openaireConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'biorxiv' || source === 'medrxiv') {
      const { BiorxivConnector } = await import('./sources/biorxiv');
      const biorxivConnector = new BiorxivConnector();
      const results = await biorxivConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'doaj') {
      const { DOAJConnector } = await import('./sources/doaj');
      const doajConnector = new DOAJConnector();
      const results = await doajConnector.search({ q: sourceId, page: 1, pageSize: 1 });
      paper = results[0] || null;
    } else if (source === 'openalex') {
      // Handle OpenAlex works directly via API
      try {
        const { OpenAlexClient } = await import('./lib/clients/openalex');
        const openalexClient = new OpenAlexClient(userAgent);
        const work = await openalexClient.getWork(sourceId);
        
        // Convert OpenAlex work to OARecord format
        paper = {
          id: work.id,
          title: work.title,
          authors: work.authorships?.map(a => a.author.display_name) || [],
          abstract: work.abstract_inverted_index ? 
            Object.entries(work.abstract_inverted_index)
              .sort(([,a], [,b]) => a[0] - b[0])
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
      } catch (error) {
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
    await paperCacheManager.cachePaperDetails(paper);
    
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

  } catch (error: any) {
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
    const metrics = cacheManager.getMetrics();
    const warmingStats = cacheWarmer.getWarmingStats();
    
    return {
      cache: metrics,
      warming: warmingStats,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Cache warming endpoint
fastify.post('/api/cache/warm', async (request, reply) => {
  try {
    await cacheWarmer.startWarming();
    return { 
      message: 'Cache warming started',
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Cache clear endpoint
fastify.post('/api/cache/clear', async (request, reply) => {
  try {
    await cacheManager.clear();
    return { 
      message: 'Cache cleared',
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
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

// Start server with cache warming
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
    
    // Start cache warming in background
    console.log('Starting cache warming...');
    cacheWarmer.startWarming().catch(err => {
      console.error('Cache warming failed:', err);
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      await cacheManager.close();
      await fastify.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down gracefully...');
      await cacheManager.close();
      await fastify.close();
      process.exit(0);
    });
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
