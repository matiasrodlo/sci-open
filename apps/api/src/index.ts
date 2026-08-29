import dotenv from 'dotenv';
import path from 'path';

// Load .env from workspace root.
// This package compiles to CommonJS (tsconfig `module: "commonjs"`, no `"type":
// "module"` in package.json), under both `tsx watch` in dev and `node dist` in
// production, so `__dirname` is always defined. It resolves to the workspace
// root from either src/ or dist/, which are at the same depth.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { SearchParams, SearchResponse, OARecord } from '@open-access-explorer/shared';
import { EnhancedSearchPipeline } from './lib/enhanced-search-pipeline';
import { SmartSourceConfigManager } from './lib/smart-source-config';
import { 
  getSearchCache, 
  getPaperCache, 
  generateCacheKey,
  searchCacheManager,
  paperCacheManager,
  cacheManager
} from './lib/cache';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { httpPerformanceTester } from './lib/http-performance-test';
import { assertPublicHttpUrl, fetchPdfStream, PdfProxyError } from './lib/pdf-proxy';
import { adminOnly, getAdminKey } from './lib/admin-auth';

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
  // Ceiling on how deep a single request reads into each source
  maxResults: parseInt(process.env.SEARCH_MAX_FETCH_DEPTH || '600'),
  enableEnrichment: true,
  enablePdfResolution: true,
  enableCitations: false,
  enableSmartSourceSelection: process.env.ENABLE_SMART_SOURCE_SELECTION === 'true',
  enableAdaptiveLearning: process.env.ENABLE_ADAPTIVE_LEARNING === 'true'
});

// Ceilings for the ad-hoc load tester on /api/performance/test
const MAX_TEST_REQUESTS = 500;
const MAX_TEST_CONCURRENCY = 50;

// Search endpoint with advanced caching
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    const params = request.body;

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
      const { records: results } = await arxivConnector.search({ titleOrKeywords: sourceId });
      paper = results[0] || null;
    } else if (source === 'core') {
      const { CoreConnector } = await import('./sources/core');
      const coreConnector = new CoreConnector(
        process.env.CORE_BASE || 'https://api.core.ac.uk/v3',
        process.env.CORE_API_KEY || ''
      );
      const { records: results } = await coreConnector.search({ titleOrKeywords: `id:${sourceId}` });
      paper = results[0] || null;
    } else if (source === 'europepmc') {
      const { EuropePMCConnector } = await import('./sources/europepmc');
      const pmcConnector = new EuropePMCConnector();
      const { records: results } = await pmcConnector.search({ titleOrKeywords: sourceId });
      paper = results[0] || null;
    } else if (source === 'ncbi') {
      const { NCBIConnector } = await import('./sources/ncbi');
      const ncbiConnector = new NCBIConnector();
      const { records: results } = await ncbiConnector.search({ titleOrKeywords: sourceId });
      paper = results[0] || null;
    } else if (source === 'openaire') {
      const { OpenAIREConnector } = await import('./sources/openaire');
      const openaireConnector = new OpenAIREConnector();
      const { records: results } = await openaireConnector.search({ titleOrKeywords: sourceId });
      paper = results[0] || null;
    } else if (source === 'biorxiv' || source === 'medrxiv') {
      const { BiorxivConnector } = await import('./sources/biorxiv');
      const biorxivConnector = new BiorxivConnector();
      const { records: results } = await biorxivConnector.search({ titleOrKeywords: sourceId });
      paper = results[0] || null;
    } else if (source === 'doaj') {
      const { DOAJConnector } = await import('./sources/doaj');
      const doajConnector = new DOAJConnector();
      const { records: results } = await doajConnector.search({ titleOrKeywords: sourceId });
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
          sourceId,
          language: work.language || 'en',
          createdAt: work.created_date || new Date().toISOString()
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

// PDF download proxy. Publishers rarely allow a cross-origin fetch from the
// browser, so the file is streamed through the API and handed to the client as
// an attachment.
fastify.post<{ Body: { paperId?: string; pdfUrl?: string } }>('/api/download-pdf', async (request, reply) => {
  const { paperId, pdfUrl } = request.body || {};

  if (!pdfUrl) {
    reply.code(400);
    return { error: 'pdfUrl is required' };
  }

  try {
    const url = await assertPublicHttpUrl(pdfUrl);
    const pdf = await fetchPdfStream(url, userAgent);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    if (pdf.contentLength) {
      reply.header('Content-Length', pdf.contentLength.toString());
    }
    reply.header('Cache-Control', 'private, max-age=3600');

    fastify.log.info({ paperId, pdfUrl: url.href }, 'Streaming PDF to client');
    return reply.send(pdf.stream);

  } catch (error: any) {
    const statusCode = error instanceof PdfProxyError ? error.statusCode : 502;
    fastify.log.warn({ paperId, pdfUrl, statusCode, error: error.message }, 'PDF download failed');
    reply.code(statusCode);
    return { error: error.message };
  }
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Cache metrics endpoint
fastify.get('/api/cache/metrics', adminOnly, async (request, reply) => {
  try {
    return {
      cache: cacheManager.getMetrics(),
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    reply.code(500);
    return { error: error.message };
  }
});

// Cache clear endpoint
fastify.post('/api/cache/clear', adminOnly, async (request, reply) => {
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
fastify.get('/debug/sources', adminOnly, async (request, reply) => {
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
fastify.get('/debug/aggregators', adminOnly, async (request, reply) => {
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
fastify.get('/api/performance/metrics', adminOnly, async (request, reply) => {
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

fastify.get('/api/performance/metrics/:service', adminOnly, async (request, reply) => {
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

fastify.get('/api/performance/comparison/:service', adminOnly, async (request, reply) => {
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

fastify.get('/api/performance/report', adminOnly, async (request, reply) => {
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

fastify.post('/api/performance/test', adminOnly, async (request, reply) => {
  try {
    const { service, baseUrl, endpoint, requests = 50, concurrency = 10 } = request.body as any;
    
    if (!service || !baseUrl || !endpoint) {
      reply.code(400);
      return { error: 'Missing required parameters: service, baseUrl, endpoint' };
    }

    // baseUrl and endpoint both come from the request body, so this route would
    // otherwise point the load tester at anything the server can reach. The
    // same public-address check the PDF proxy uses applies here.
    let target: URL;
    try {
      target = await assertPublicHttpUrl(String(baseUrl));
    } catch (error: any) {
      reply.code(error instanceof PdfProxyError ? error.statusCode : 400);
      return { error: 'baseUrl must resolve to a public http or https address' };
    }

    // An absolute or protocol-relative endpoint overrides the axios baseURL,
    // which would slip past the check above.
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.startsWith('//')) {
      reply.code(400);
      return { error: 'endpoint must be a path beginning with a single /' };
    }

    // Bounded so an authenticated caller cannot turn this into an amplifier.
    const boundedRequests = Math.min(Math.max(parseInt(String(requests), 10) || 1, 1), MAX_TEST_REQUESTS);
    const boundedConcurrency = Math.min(Math.max(parseInt(String(concurrency), 10) || 1, 1), MAX_TEST_CONCURRENCY);

    const result = await httpPerformanceTester.runTest({
      service,
      baseUrl: target.href,
      endpoint,
      requests: boundedRequests,
      concurrency: boundedConcurrency,
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

fastify.post('/api/performance/test/comprehensive', adminOnly, async (request, reply) => {
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

fastify.post('/api/performance/test/compare', adminOnly, async (request, reply) => {
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

    if (!getAdminKey()) {
      fastify.log.warn(
        'ADMIN_API_KEY is not set: the cache, performance, smart-source and debug endpoints are disabled'
      );
    }

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
fastify.get('/api/smart-source/config', adminOnly, async (request, reply) => {
  try {
    const config = smartSourceConfig.getConfig();
    return { success: true, config };
  } catch (error) {
    fastify.log.error({ error }, 'Error getting smart source config');
    reply.code(500);
    return { error: 'Failed to get smart source configuration' };
  }
});

fastify.post('/api/smart-source/config', adminOnly, async (request, reply) => {
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

fastify.get('/api/smart-source/test', adminOnly, async (request, reply) => {
  try {
    const testResults = await smartSourceConfig.runTests();
    return testResults;
  } catch (error) {
    fastify.log.error({ error }, 'Error running smart source tests');
    reply.code(500);
    return { error: 'Failed to run smart source tests' };
  }
});

fastify.get('/api/smart-source/performance', adminOnly, async (request, reply) => {
  try {
    const recommendations = smartSourceConfig.getRecommendations();
    return recommendations;
  } catch (error) {
    fastify.log.error({ error }, 'Error getting smart source performance');
    reply.code(500);
    return { error: 'Failed to get smart source performance data' };
  }
});

fastify.get('/api/smart-source/export', adminOnly, async (request, reply) => {
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
