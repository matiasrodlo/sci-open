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
import { EnhancedSearchPipeline } from './lib/enhanced-search-pipeline';
import { SmartSourceConfigManager } from './lib/smart-source-config';
import { 
  getSearchCache, 
  getPaperCache, 
  generateCacheKey,
  searchCacheManager,
  paperCacheManager,
  cacheWarmer,
  cacheManager
} from './lib/cache';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { httpPerformanceTester } from './lib/http-performance-test';

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

// Initialize smart source selection configuration
const smartSourceConfig = new SmartSourceConfigManager({
  enabled: process.env.ENABLE_SMART_SOURCE_SELECTION === 'true',
  adaptiveLearning: process.env.ENABLE_ADAPTIVE_LEARNING === 'true',
  performanceMonitoring: process.env.ENABLE_PERFORMANCE_MONITORING === 'true',
  maxSources: parseInt(process.env.SMART_SOURCE_MAX_SOURCES || '4'),
  timeoutMs: parseInt(process.env.SMART_SOURCE_TIMEOUT_MS || '8000'),
  confidenceThreshold: parseFloat(process.env.SMART_SOURCE_CONFIDENCE_THRESHOLD || '0.6')
});

// Initialize enhanced search pipeline with smart source selection
const searchPipeline = new EnhancedSearchPipeline({
  userAgent,
  maxResults: 100,
  enableEnrichment: true,
  enablePdfResolution: true,
  enableCitations: false,
  enableSmartSourceSelection: process.env.ENABLE_SMART_SOURCE_SELECTION === 'true',
  enableAdaptiveLearning: process.env.ENABLE_ADAPTIVE_LEARNING === 'true'
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
      query: request.body?.q,
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

// HTTP Performance Monitoring Endpoints
fastify.get('/api/performance/metrics', async (request, reply) => {
  try {
    const overall = httpPerformanceMonitor.getOverallPerformance();
    return {
      success: true,
      data: overall,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.get('/api/performance/metrics/:service', async (request, reply) => {
  try {
    const { service } = request.params as { service: string };
    const metrics = httpPerformanceMonitor.getCurrentMetrics(service);
    
    if (!metrics) {
      reply.code(404);
      return { error: `No metrics found for service: ${service}` };
    }
    
    return {
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.get('/api/performance/comparison/:service', async (request, reply) => {
  try {
    const { service } = request.params as { service: string };
    const comparison = httpPerformanceMonitor.getPerformanceComparison(service);
    
    if (!comparison) {
      reply.code(404);
      return { error: `No comparison data found for service: ${service}` };
    }
    
    return {
      success: true,
      data: comparison,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.get('/api/performance/report', async (request, reply) => {
  try {
    const report = httpPerformanceMonitor.generateReport();
    return {
      success: true,
      data: { report },
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.post('/api/performance/test', async (request, reply) => {
  try {
    const { service, baseUrl, endpoint, requests = 50, concurrency = 10 } = request.body as any;
    
    if (!service || !baseUrl || !endpoint) {
      reply.code(400);
      return { error: 'Missing required parameters: service, baseUrl, endpoint' };
    }
    
    const result = await httpPerformanceTester.runTest({
      service,
      baseUrl,
      endpoint,
      requests,
      concurrency,
      warmupRequests: 5
    });
    
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.post('/api/performance/test/comprehensive', async (request, reply) => {
  try {
    const results = await httpPerformanceTester.runComprehensiveTests();
    
    return {
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

fastify.post('/api/performance/test/compare', async (request, reply) => {
  try {
    const comparison = await httpPerformanceTester.comparePerformance();
    
    return {
      success: true,
      data: comparison,
      timestamp: new Date().toISOString()
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
    
    // Start HTTP performance monitoring
    console.log('Starting HTTP performance monitoring...');
    httpPerformanceMonitor.startMonitoring(30000); // 30 second intervals
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      httpPerformanceMonitor.stopMonitoring();
      await cacheManager.close();
      await fastify.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down gracefully...');
      httpPerformanceMonitor.stopMonitoring();
      await cacheManager.close();
      await fastify.close();
      process.exit(0);
    });
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Smart Source Selection Endpoints
fastify.get('/api/smart-source/config', async (request, reply) => {
  try {
    const config = smartSourceConfig.getConfig();
    return { success: true, config };
  } catch (error) {
    fastify.log.error({ error }, 'Error getting smart source config');
    reply.code(500);
    return { error: 'Failed to get smart source configuration' };
  }
});

fastify.post('/api/smart-source/config', async (request, reply) => {
  try {
    const newConfig = request.body as any;
    smartSourceConfig.updateConfig(newConfig);
    const updatedConfig = smartSourceConfig.getConfig();
    return { success: true, config: updatedConfig };
  } catch (error) {
    fastify.log.error({ error }, 'Error updating smart source config');
    reply.code(500);
    return { error: 'Failed to update smart source configuration' };
  }
});

fastify.get('/api/smart-source/test', async (request, reply) => {
  try {
    const testResults = await smartSourceConfig.runTests();
    return testResults;
  } catch (error) {
    fastify.log.error({ error }, 'Error running smart source tests');
    reply.code(500);
    return { error: 'Failed to run smart source tests' };
  }
});

fastify.get('/api/smart-source/performance', async (request, reply) => {
  try {
    const recommendations = smartSourceConfig.getRecommendations();
    return recommendations;
  } catch (error) {
    fastify.log.error({ error }, 'Error getting smart source performance');
    reply.code(500);
    return { error: 'Failed to get smart source performance data' };
  }
});

fastify.get('/api/smart-source/export', async (request, reply) => {
  try {
    const exportData = smartSourceConfig.exportData();
    return exportData;
  } catch (error) {
    fastify.log.error({ error }, 'Error exporting smart source data');
    reply.code(500);
    return { error: 'Failed to export smart source data' };
  }
});

start();
