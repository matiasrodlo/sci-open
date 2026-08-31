import dotenv from 'dotenv';
import path from 'path';

// Load .env from workspace root.
// This package compiles to CommonJS (tsconfig `module: "commonjs"`, no `"type":
// "module"` in package.json), under both `tsx watch` in dev and `node dist` in
// production, so `__dirname` is always defined. It resolves to the workspace
// root from either src/ or dist/, which are at the same depth.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { SearchParams, toOARecord } from '@open-access-explorer/shared';
import { searchCacheManager, paperCacheManager, cacheManager } from './lib/cache';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { assertPublicHttpUrl, fetchPdfStream, PdfProxyError } from './lib/pdf-proxy';
import { adminOnly, getAdminKey } from './lib/admin-auth';
import { SingleFlight } from './lib/single-flight';
import { log, useLogger } from './lib/logger';
import { searchBodySchema, paperParamsSchema, downloadPdfBodySchema } from './lib/schemas';
import { clientError } from './lib/client-error';
import { ProviderCache, lookupPaper } from './orchestrator';
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

/**
 * A search costs a fan-out to ten providers, so an unthrottled caller is not
 * only a cost to us — it spends the shared rate limits every other user's
 * searches depend on, and OpenAlex's daily budget is small enough that one
 * script can exhaust it for everyone.
 *
 * The window is generous for a person and tight for a loop. `/health` is
 * exempt so a container's own probe cannot be throttled out of reporting.
 */
fastify.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX) || 120,
  timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  allowList: (request) => request.url === '/health',
  addHeadersOnExceeding: { 'x-ratelimit-remaining': true },
  errorResponseBuilder: (_request, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry in ${context.after}.`
  })
});

// Who we say we are to every provider. OpenAlex and Unpaywall both route a
// caller who identifies themselves into a faster pool, and read the address
// out of this string.
const userAgent = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'your-email@example.com'})`;

// Collapses concurrent identical searches onto one fan-out. A miss costs tens
// of seconds across every provider, which is a wide window for duplicates.
const searchFlights = new SingleFlight();

// Lives for the process, not the request. Caching what each provider returned
// only pays across requests — it is what makes a page-2 click reuse the
// fan-out instead of repeating it. Built either way; an unused one is an
// empty Map.
const providerCache = new ProviderCache();

/**
 * Every route, registered as a plugin rather than on the root instance.
 *
 * This is not tidiness, it is the only arrangement in which the rate limiter
 * works. `@fastify/rate-limit` attaches through an **`onRoute`** hook —
 * `addHook('onRoute', ...)` at index.js:126 — and an `onRoute` hook only fires
 * for routes registered after it exists. `fastify.register()` defers loading
 * until `ready()`, so routes declared on the root instance in module scope were
 * already in the router before the plugin's hook was added, and every one of
 * them was skipped. Measured before the fix: 130 requests against a limit of 3
 * all returned normally, with no `x-ratelimit-*` headers on any of them.
 *
 * `@fastify/cors` and `@fastify/helmet` were registered the same way and were
 * unaffected, which is what made this hard to see: they add request-time hooks,
 * which are resolved per request from the context and do not care when a route
 * was added. Their headers were present the whole time.
 *
 * Registering the routes as a plugin puts them behind rate-limit in the boot
 * queue, so the hook exists by the time they are added. The parameter shadows
 * the outer instance deliberately: inside here `fastify` is the child context,
 * which is what every route should be registering against anyway.
 */
async function routes(fastify: FastifyInstance) {
  // Search endpoint with advanced caching
  fastify.post<{ Body: SearchParams }>('/api/search', {
    schema: { body: searchBodySchema }
  }, async (request, reply) => {
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

      // Everything from here to the cache write happens once per key, however
      // many callers are waiting on it.
      const { value: searchResult, coalesced } = await searchFlights.run(
        searchCacheManager.keyFor(params.q || '', params),
        async () => {
          const result = await runOrchestrator(params, { cache: providerCache, userAgent });

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
        coalesced
      }, 'Search completed');
    
      return searchResult;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      fastify.log.error({ 
        error: error.message, 
        query: request.body?.q,
        responseTime 
      }, 'Search error');
      reply.code(500);
      return clientError(error, request.id);
    }
  });

  // Paper details endpoint with advanced caching
  fastify.get<{ Params: { id: string } }>('/api/paper/:id', {
    schema: { params: paperParamsSchema }
  }, async (request, reply) => {
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

      // One question, asked of the provider that owns the id. Which request
      // that becomes — a by-id endpoint, a DOI lookup, or a search of the
      // provider's own index — is the registry's business rather than the
      // route's, which is why a hundred lines of per-connector branching
      // could go.
      const found = await lookupPaper(id, { userAgent });
      const paper = found ? toOARecord(found) : null;

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
      return clientError(error, request.id);
    }
  });

  // PDF download proxy. Publishers rarely allow a cross-origin fetch from the
  // browser, so the file is streamed through the API and handed to the client as
  // an attachment.
  // `pdfUrl` is non-optional here because the schema requires it: validation
  // rejects the request before the handler runs, so the type says what is
  // actually true inside it rather than repeating a check Fastify already made.
  fastify.post<{ Body: { paperId?: string; pdfUrl: string } }>('/api/download-pdf', {
    schema: { body: downloadPdfBodySchema }
  }, async (request, reply) => {
    const { paperId, pdfUrl } = request.body;

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
      return clientError(error, request.id);
    }
  });

  // Health check endpoint
  fastify.get('/health', async () => {
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
      return clientError(error, request.id);
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
      return clientError(error, request.id);
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
      return clientError(error, request.id);
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
      return clientError(error, request.id);
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
      return clientError(error, request.id);
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
      return clientError(error, request.id);
    }
  });
}

fastify.register(routes);

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
