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
import { 
  getSearchCache, 
  getPaperCache, 
  generateCacheKey,
  searchCacheManager,
  paperCacheManager,
  cacheManager
} from './lib/cache';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { assertPublicHttpUrl, fetchPdfStream, PdfProxyError } from './lib/pdf-proxy';
import { adminOnly, getAdminKey } from './lib/admin-auth';
import { SingleFlight } from './lib/single-flight';
import { log, useLogger } from './lib/logger';
import { resolveSearchPath } from './lib/search-path';
import { ProviderCache } from './orchestrator';
import { runOrchestrator } from './orchestrator/from-search-params';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  }
});

// Connectors and pipeline code log through lib/logger, which forwards here.
// Until this runs they stay silent apart from warnings and errors, so nothing
// during module load escapes the configured level.
useLogger(fastify.log);

// Register plugins
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
});

fastify.register(helmet);

// Initialize search pipeline
const userAgent = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'your-email@example.com'})`;

// Initialize the search pipeline
const searchPipeline = new EnhancedSearchPipeline({
  userAgent,
  // Ceiling on how deep a single request reads into each source
  maxResults: parseInt(process.env.SEARCH_MAX_FETCH_DEPTH || '600'),
  enableEnrichment: true,
  enablePdfResolution: true,
  enableCitations: false
});

// Collapses concurrent identical searches onto one fan-out. A miss costs tens
// of seconds across every provider, which is a wide window for duplicates.
const searchFlights = new SingleFlight();

// Which implementation serves `/api/search`. Read once, at boot: a value that
// could change mid-process would let one response cache hold bodies from two
// different code paths, and the cache key has no room to tell them apart.
// Flipping it means a restart, which empties that cache — it is an in-memory
// NodeCache — so a response recorded by one path is never served by the other.
const searchPath = resolveSearchPath();
log.info(`Search path: ${searchPath}`);

// Lives for the process, not the request. Caching what each provider returned
// only pays across requests — it is what makes a page-2 click reuse the
// fan-out instead of repeating it. Built either way; an unused one is an
// empty Map.
const providerCache = new ProviderCache();

// Search endpoint with advanced caching
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    const params = request.body;

    // Set before the cache checks so every reply carries it, including the two
    // that return early. A cached body is attributable to this path too: the
    // flag is fixed at boot and the cache does not outlive the process, so
    // nothing in it was produced by the other one.
    reply.header('X-Search-Path', searchPath);

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

    // Everything from here to the cache write happens once per key, however
    // many callers are waiting on it.
    const { value: searchResult, coalesced } = await searchFlights.run(
      searchCacheManager.keyFor(params.q || '', params),
      async () => {
        // Inside the flight deliberately: both paths get the same coalescing
        // and the same cache write, so the flag changes what runs and nothing
        // about how the request is served around it.
        const result = searchPath === 'orchestrator'
          ? await runOrchestrator(params, { cache: providerCache, userAgent })
          : await searchPipeline.search(params);

        await searchCacheManager.cacheSearchResults(params.q || '', params, result);
        if (result.facets) {
          await searchCacheManager.cacheFacets(params.q || '', params, result.facets);
        }

        return result;
      }
    );

    const responseTime = Date.now() - startTime;
    reply.header('Cache-Control', 'public, max-age=300');
    reply.header('X-Cache-Hit', coalesced ? 'coalesced' : 'false');
    reply.header('X-Response-Time', responseTime.toString());
    
    fastify.log.info({
      totalResults: searchResult.total,
      query: params.q,
      responseTime,
      coalesced,
      searchPath
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
    } else if (source === 'plos') {
      const { PLOSConnector } = await import('./sources/plos');
      const plosConnector = new PLOSConnector();
      // A PLOS id *is* its DOI, so this is a DOI lookup. Sending it as
      // keywords would tokenise the identifier and match the wrong article or
      // none — and with no branch here at all, every "Details" click on a PLOS
      // result answered 404, on roughly a quarter of a typical result set.
      const { records: results } = await plosConnector.search({ doi: sourceId });
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
        log.error('OpenAlex fetch error:', error);
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

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000');
    await fastify.listen({ port, host: '0.0.0.0' });

    if (!getAdminKey()) {
      fastify.log.warn(
        'ADMIN_API_KEY is not set: the cache, performance and debug endpoints are disabled'
      );
    }

    log.info('HTTP performance monitoring started');
    httpPerformanceMonitor.startMonitoring(30000); // 30 second intervals
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      log.info('Shutting down gracefully');
      httpPerformanceMonitor.stopMonitoring();
      await cacheManager.close();
      await fastify.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      log.info('Shutting down gracefully');
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

start();
