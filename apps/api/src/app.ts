import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { SearchParams, toOARecord, type Paper } from '@open-access-explorer/shared';
import type { Config } from './config';
import type { CacheManager } from './lib/cache-manager';
import { searchKey, worthCaching } from './lib/search-key';
import { PaperCacheManager } from './lib/paper-cache-manager';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { assertPublicHttpUrl, attachmentHeader, fetchPdfStream, PdfProxyError } from './lib/pdf-proxy';
import { adminOnly } from './lib/admin-auth';
import { withLogger } from './lib/logger';
import { SingleFlight } from './lib/single-flight';
import { searchBodySchema, paperParamsSchema } from './lib/schemas';
import { clientError, clientErrorStatus, lookupErrorStatus } from './lib/client-error';
import { AuthorityCache, AuthorityFactsCache, ProviderCache, ResultSetCache, UpstreamStats, lookupPaper, enrichPage } from './orchestrator';
import { runSearch } from './orchestrator/from-search-params';
import type { ProviderEntry } from './orchestrator/registry';
import type { AuthorityEntry } from './authorities';

export type AppOptions = {
  config: Config;
  /** The response cache. The server builds it from `config`; a test brings its own. */
  cache: CacheManager;
  /** Defaults to one held under `config.cache.providerMaxBytes`. */
  providerCache?: ProviderCache;
  /** Resolved sets, so a search's pages slice one set. Defaults to an empty one. */
  resultSets?: ResultSetCache;
  /** Authorities' answers across requests. Defaults to an empty one. */
  authorityFacts?: AuthorityFactsCache;
  /** How each source has fared across requests. Defaults to an empty one. */
  stats?: UpstreamStats;
  /** Default to the registries. A subset is how the routes are driven offline. */
  providers?: readonly ProviderEntry[];
  authorities?: readonly AuthorityEntry[];
  /** Fastify's `logger` option. Defaults to `config.logLevel`. */
  logger?: FastifyServerOptions['logger'];
};

/**
 * The API, built and not started.
 *
 * Everything a request touches is handed in — the settings, the cache, the
 * providers — and nothing is read from the environment or connected to on
 * import. That is what lets the routes be exercised with `inject()`: while
 * this lived in `index.ts`, importing the module built the server, opened a
 * Redis connection and started listening, so no test ever sent a request to a
 * route. `index.ts` is now the one place that does those things.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { config, cache } = options;

  const fastify = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    // See `lib/trust-proxy.ts`. This is what decides whether `request.ip` — and
    // so the rate limiter's key — is the caller or the proxy in front of them.
    trustProxy: config.trustProxy
  });

  fastify.register(cors, {
    origin: config.production ? false : true,
    credentials: true
  });

  fastify.register(helmet);

  // Everything a request sets off logs as that request, `reqId` included —
  // pipeline code logs through `lib/logger`, not through `request.log`.
  fastify.addHook('onRequest', (request, _reply, done) => withLogger(request.log, done));

  /**
   * A search costs a fan-out to ten providers, so an unthrottled caller is not
   * only a cost to us — it spends the shared rate limits every other user's
   * searches depend on, and OpenAlex's daily budget is small enough that one
   * script can exhaust it for everyone.
   *
   * The window is generous for a person and tight for a loop. `/health` is
   * exempt so a container's own probe cannot be throttled out of reporting.
   *
   * The key is `request.ip`, which is the default and is deliberate — but it only
   * names the caller when `TRUST_PROXY` says which hops in front of us are ours.
   * Without it every request arrives from the web tier's address and this becomes
   * one bucket for the whole site rather than one per caller. See
   * `lib/trust-proxy.ts`; the warning at startup covers the case where it is
   * needed and missing.
   */
  fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    allowList: (request) => request.url === '/health',
    addHeadersOnExceeding: { 'x-ratelimit-remaining': true },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${context.after}.`
    })
  });

  fastify.register(routes, {
    config,
    cache,
    paperCacheManager: new PaperCacheManager(cache),
    // Collapses concurrent identical searches onto one fan-out. A miss costs
    // tens of seconds across every provider, which is a wide window for
    // duplicates.
    searchFlights: new SingleFlight(),
    // Lives as long as the app, not the request. Caching what each provider
    // returned only pays across requests — it is what makes a page-2 click
    // reuse the fan-out instead of repeating it.
    providerCache: options.providerCache ?? new ProviderCache({ maxBytes: config.cache.providerMaxBytes }),
    // Search is cached here and not in `cache`, which holds paper details:
    // what a search resolved to, and what the authorities said about its
    // papers. See `orchestrator/result-set.ts`.
    resultSets: options.resultSets ?? new ResultSetCache(),
    authorityFacts: options.authorityFacts ?? new AuthorityFactsCache(),
    stats: options.stats ?? new UpstreamStats(),
    ...(options.providers ? { providers: options.providers } : {}),
    ...(options.authorities ? { authorities: options.authorities } : {})
  });

  return fastify;
}

/** A provider failed while being asked for one record, with the status that failure deserves. */
class PaperLookupError extends Error {
  readonly status: number;

  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PaperLookupError';
    this.status = lookupErrorStatus(cause);
  }
}

/** What the routes are built over, handed to them as the plugin's options. */
type RouteContext = {
  config: Config;
  cache: CacheManager;
  paperCacheManager: PaperCacheManager;
  searchFlights: SingleFlight;
  providerCache: ProviderCache;
  resultSets: ResultSetCache;
  authorityFacts: AuthorityFactsCache;
  stats: UpstreamStats;
  providers?: readonly ProviderEntry[];
  authorities?: readonly AuthorityEntry[];
};

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
 * `__tests__/app.test.ts` sends a route past its limit, so moving these back
 * onto the root instance now fails a test rather than a production load.
 */
async function routes(fastify: FastifyInstance, context: RouteContext) {
  const { config, cache, paperCacheManager, searchFlights, providerCache, resultSets, authorityFacts, stats } = context;
  // Who we say we are to every provider. See `UNPAYWALL_EMAIL` in `config.ts`.
  const userAgent = config.userAgent;
  const admin = adminOnly(config.adminKey);
  const upstream = {
    ...(context.providers ? { providers: context.providers } : {}),
    ...(context.authorities ? { authorities: context.authorities } : {})
  };
  const lookupFrom = context.providers ? { providers: context.providers } : {};
  const enrichWith = context.authorities ? { authorities: context.authorities } : {};

  // Search endpoint with advanced caching
  /**
   * A search, answered in either version of the response. Both come from one
   * run of `runSearch`, joined under one key, so a v1 and a v2 request for the
   * same search share the work and the set — and cannot disagree.
   */
  const answerSearch = (version: 1 | 2) => async (
    request: FastifyRequest<{ Body: SearchParams }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();
  
    try {
      const params = request.body;

      // Collapses concurrent identical requests onto one run. The set behind
      // them is held by `resultSets`, so a new page of a search already
      // resolved is a slice and twenty enrichments, not a fan-out.
      const { value: { response: searchResult, responseV2, fromCache }, coalesced } = await searchFlights.run(
        searchKey(params),
        () => runSearch(params, {
          cache: providerCache,
          resultSets,
          authorityFacts,
          stats,
          userAgent,
          settings: config.search,
          ...upstream
        })
      );

      if (!worthCaching(searchResult) && !coalesced) {
        // A degraded set is returned but not held — see `worthCaching`. The
        // answer is still worth having; `complete` is in the response so the
        // UI can say what it is.
        fastify.log.warn(
          { query: params.q, total: searchResult.total },
          'Search incomplete; returning it unheld so a retry can reach the providers that failed'
        );
      }

      const responseTime = Date.now() - startTime;
      /**
       * The same rule the set cache applies, stated to every cache between here
       * and the reader — and on this route, stated to nobody.
       *
       * Search is a POST, and a POST response is not cacheable in any way that
       * a later POST can be answered from: RFC 9111 lets a cache store one only
       * against a `Content-Location` this never sets, and then only to answer a
       * subsequent *GET* of that URI. So neither branch here does anything, and
       * that includes `no-store` — the protection this line was credited with
       * was never in force. What actually keeps a degraded answer out of the
       * way of the retry is `ResultSetCache` refusing to hold it, which is a
       * decision this service makes for itself and does not delegate.
       *
       * Kept rather than deleted, because it is the correct header either way
       * and the cost of being right is one line. It becomes load-bearing the
       * moment anything about this route changes — a GET variant for
       * bookmarkable searches, a CDN in front of the API — and the failure it
       * would prevent then is a stale degraded answer served to everyone, which
       * is worth more than the line costs now. It is documentation of intent
       * until then, not a control.
       */
      reply.header(
        'Cache-Control',
        worthCaching(searchResult) ? 'public, max-age=300' : 'no-store'
      );
      // Whether the set was held — the page itself is presented every time.
      reply.header('X-Cache-Hit', coalesced ? 'coalesced' : fromCache ? 'true' : 'false');
      reply.header('X-Response-Time', responseTime.toString());
    
      fastify.log.info({
        totalResults: searchResult.total,
        query: params.q,
        responseTime,
        fromCache,
        coalesced
      }, 'Search completed');
    
      return version === 2 ? responseV2 : searchResult;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const status = clientErrorStatus(error);

      // A rejected query is not a service failure, and logging it as one puts
      // a reader's typo in the error stream beside real outages.
      const level = status === 400 ? 'info' : 'error';
      fastify.log[level]({
        error: error.message,
        query: request.body?.q,
        responseTime
      }, status === 400 ? 'Search rejected' : 'Search error');

      reply.code(status);
      return clientError(error, request.id);
    }
  };

  fastify.post<{ Body: SearchParams }>('/api/search', { schema: { body: searchBodySchema } }, answerSearch(1));
  fastify.post<{ Body: SearchParams }>('/api/v2/search', { schema: { body: searchBodySchema } }, answerSearch(2));

  /**
   * The paper behind an id, as both versions of `/api/paper/:id` return it:
   * from the cache, or from the provider that owns the id and then the
   * authorities, and cached.
   *
   * Shared by the details route and the PDF route, so the file a reader
   * downloads is the copy the page they are on shows. `null` when nobody holds
   * the id. A provider's failure is thrown as a `PaperLookupError` carrying the
   * status it deserves — see `lookupErrorStatus`.
   */
  async function recordFor(
    id: string
  ): Promise<{ paper: Paper; cached: boolean; complete: boolean; fieldsEnriched: number } | null> {
    const cached = await paperCacheManager.getCachedPaper(id);
    if (cached) return { paper: cached, cached: true, complete: true, fieldsEnriched: 0 };

    // A second lookup by DOI used to sit here, gated on `id.includes('10.')`.
    // That test is looser than it reads — an arXiv id like `arxiv:2310.12345`
    // contains `10.` — so ordinary requests paid a Redis round trip for a key
    // nothing had written, which is the same guaranteed miss the `partial:`
    // probe was removed from the search path for.
    //
    // Its tail was worse than the cost. For an id that genuinely is a bare
    // DOI the lookup below returns null, because `splitPaperId` finds no
    // provider prefix — so the URL answered 200 while an entry happened to be
    // cached and 404 once it expired. This endpoint takes `source:nativeId`,
    // as `docs/api.md` says and as the frontend only ever sends; a DOI is
    // asked about through `POST /api/search` with `{ doi }`, which resolves
    // it properly across every provider that can answer. The answer here is
    // now consistently 404, and `cachePaperDetails` no longer writes a second
    // copy under a key nothing reads.

    // One question, asked of the provider that owns the id. Which request
    // that becomes — a by-id endpoint, a DOI lookup, or a search of the
    // provider's own index — is the registry's business rather than the
    // route's, which is why a hundred lines of per-connector branching
    // could go.
    let found: Paper | null;
    try {
      found = await lookupPaper(id, { userAgent, ...lookupFrom });
    } catch (error) {
      throw new PaperLookupError(error);
    }
    if (!found) return null;

    /**
     * The same authorities the search path asks about its page, asked about
     * the one record this endpoint returns.
     *
     * Without this the two ways of reaching a paper page disagreed, and the
     * shareable one was the worse one. A click from the results list carries
     * the record the search produced — merged across every provider that
     * returned the work, then enriched — because the frontend caches it in
     * `sessionStorage` on the way. A shared link, a reload or a new tab has
     * no such copy and lands here, where `lookupPaper` asks exactly one
     * provider and returns what it says: no citation count from
     * OpenCitations, no access route or verified copy from Unpaywall, no
     * fields filled in from Crossref. Same URL, two bodies.
     *
     * It is cheap where it lands. `enrichPage` returns immediately for a
     * paper carrying no DOI, each lookup is bounded by its own timeout and
     * the step's budget, an authority that fails is reported rather than
     * thrown — so an Unpaywall outage costs the enrichment, not the paper —
     * and this runs only on a cache miss, which is precisely the request
     * that was being answered poorly. The result is then cached like any
     * other, so the second visitor pays nothing.
     */
    const { papers: [paper], reports } = await enrichPage([found], { userAgent, cache: new AuthorityCache(authorityFacts), ...enrichWith });
    stats.recordAuthorities(reports);

    // An authority that failed may have held something this paper lacks, so
    // the record is held briefly rather than for hours — the rule the search
    // path applies to a set a provider failed on. See `cachePaperDetails`.
    const complete = !reports.some(report => report.status === 'error' || report.status === 'timeout');
    await paperCacheManager.cachePaperDetails(paper, { partial: !complete });

    // The fields the authorities actually wrote, which is the only number
    // that says whether asking them was worth the requests.
    return { paper, cached: false, complete, fieldsEnriched: reports.reduce((total, report) => total + report.applied, 0) };
  }

  /** Answers a failed `recordFor`: the provider's status for its failures, 500 for ours. */
  function lookupFailed(error: unknown, id: string, reply: FastifyReply, requestId: string) {
    if (error instanceof PaperLookupError) {
      fastify.log[error.status === 500 ? 'error' : 'warn'](
        { id, status: error.status, error: error.message },
        'Could not fetch paper details from its provider'
      );
      reply.code(error.status);
      return clientError(error.cause, requestId);
    }
    fastify.log.error({ id, error: error instanceof Error ? error.message : String(error) }, 'Error fetching paper details');
    reply.code(500);
    return clientError(error, requestId);
  }

  /**
   * One paper, in either version: the `Paper` itself for version 2, and for
   * version 1 flattened to the `OARecord` that version has always returned.
   * Both are the one record `recordFor` holds, so they cannot disagree.
   */
  const answerPaper = (version: 1 | 2) => async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();
    const { id } = request.params;

    let record;
    try {
      record = await recordFor(id);
    } catch (error) {
      return lookupFailed(error, id, reply, request.id);
    }

    if (!record) {
      reply.code(404);
      return { error: 'Paper not found' };
    }

    const responseTime = Date.now() - startTime;
    reply.header('Cache-Control', record.complete ? 'public, max-age=600' : 'no-store');
    reply.header('X-Cache-Hit', record.cached ? 'true' : 'false');
    reply.header('X-Response-Time', responseTime.toString());
    fastify.log.info({
      id,
      title: record.paper.title,
      responseTime,
      cached: record.cached,
      fieldsEnriched: record.fieldsEnriched
    }, 'Paper details');

    return version === 2 ? record.paper : toOARecord(record.paper);
  };

  fastify.get<{ Params: { id: string } }>('/api/paper/:id', { schema: { params: paperParamsSchema } }, answerPaper(1));
  fastify.get<{ Params: { id: string } }>('/api/v2/paper/:id', { schema: { params: paperParamsSchema } }, answerPaper(2));

  /**
   * A paper's PDF, streamed through the API and handed over as an attachment:
   * publishers rarely allow a cross-origin fetch from the browser.
   *
   * By the paper's id, not by a URL. The download used to take a `pdfUrl` in a
   * POST body and fetch whatever it named, which made it a general-purpose
   * fetcher for anyone who could reach it — the SSRF guard was all that stood
   * between a caller and the private network, so a gap in the guard was a gap
   * in the whole API. The address now comes from the paper record this
   * service holds, the one the details page shows; the guard stays in front of
   * it as the second line rather than the only one. And as a GET, the
   * `Cache-Control` it sends finally means what it says.
   *
   * It has a rate-limit budget of its own, because it is not the same kind of
   * request as a search.
   *
   * Both used to spend the one `RATE_LIMIT_MAX`, which priced two things that
   * are expensive in different currencies as though they were the same. A
   * search costs a fan-out to ten providers and a few kilobytes back: what it
   * spends is other people's API quota. A download costs one upstream request
   * and streams up to `MAX_PDF_BYTES` — fifty megabytes — holding a socket open
   * for as long as the publisher takes: what it spends is bandwidth and
   * connections. One number could only be right for one of them, and it was set
   * for search.
   *
   * Twenty a minute is many more PDFs than a person opens and far fewer than a
   * scraper wants. The worst case is still large — twenty times fifty megabytes
   * is a gigabyte a minute per caller — so this is a starting point to measure
   * against real traffic, not a settled figure; `RATE_LIMIT_DOWNLOAD_MAX` is
   * there so it can move without a deploy of new code.
   *
   * A per-route `config.rateLimit` gives the route a bucket of its own rather
   * than a share of the global one, which is the point: a reader downloading
   * papers no longer spends the search allowance, and a search loop no longer
   * locks them out of the file they were reading.
   *
   * **No automatic HEAD.** Fastify answers HEAD on a GET route by running the
   * GET handler and then *draining* whatever stream it sent — so a HEAD here
   * fetched the whole PDF from the publisher, up to fifty megabytes, and threw
   * it away to send nothing. The HEAD route also got a rate-limit bucket of its
   * own, which doubled the download budget. There is no way to answer a HEAD
   * honestly without asking the publisher, so it is refused below instead.
   */
  fastify.head<{ Params: { id: string } }>('/api/papers/:id/pdf', async (_request, reply) => {
    reply.code(405).header('Allow', 'GET');
    return reply.send();
  });

  fastify.get<{ Params: { id: string } }>('/api/papers/:id/pdf', {
    exposeHeadRoute: false,
    schema: { params: paperParamsSchema },
    config: {
      rateLimit: {
        max: config.rateLimit.downloadMax,
        timeWindow: config.rateLimit.window
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;

    let record;
    try {
      record = await recordFor(id);
    } catch (error) {
      return lookupFailed(error, id, reply, request.id);
    }

    if (!record) {
      reply.code(404);
      return { error: 'Paper not found' };
    }

    const pdfUrl = record.paper.fullText?.url;
    if (!pdfUrl) {
      reply.code(404);
      return { error: 'No copy of this paper is known' };
    }

    try {
      const url = await assertPublicHttpUrl(pdfUrl);
      const pdf = await fetchPdfStream(url, userAgent);

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', attachmentHeader(record.paper.title, pdf.filename));
      if (pdf.contentLength) {
        reply.header('Content-Length', pdf.contentLength.toString());
      }
      reply.header('Cache-Control', 'private, max-age=3600');

      fastify.log.info({ id, pdfUrl: url.href }, 'Streaming PDF to client');
      return reply.send(pdf.stream);

    } catch (error: any) {
      const statusCode = error instanceof PdfProxyError ? error.statusCode : 502;
      fastify.log.warn({ id, pdfUrl, statusCode, error: error.message }, 'PDF download failed');
      reply.code(statusCode);
      return clientError(error, request.id);
    }
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Cache metrics endpoint
  fastify.get('/api/cache/metrics', admin, async (request, reply) => {
    try {
      return {
        cache: cache.getMetrics(),
        resultSets: resultSets.stats(),
        providers: providerCache.stats(),
        authorityFacts: authorityFacts.size,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      reply.code(500);
      return clientError(error, request.id);
    }
  });

  // Cache clear endpoint
  fastify.post('/api/cache/clear', admin, async (request, reply) => {
    try {
      // Everything this service remembers about an answer, so a search after
      // this asks the sources again rather than slicing a set held from before.
      await cache.clear();
      resultSets.clear();
      providerCache.clear();
      authorityFacts.clear();
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
  fastify.get('/api/performance/metrics', admin, async (request, reply) => {
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

  fastify.get('/api/performance/metrics/:service', admin, async (request, reply) => {
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

  // What the pipeline got out of each source — the HTTP metrics above count
  // requests to hosts, this counts answers. See `orchestrator/upstream-stats.ts`.
  fastify.get('/api/performance/sources', admin, async () => ({
    success: true,
    data: stats.snapshot(),
    timestamp: new Date().toISOString()
  }));

  fastify.get('/api/performance/report', admin, async (request, reply) => {
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
