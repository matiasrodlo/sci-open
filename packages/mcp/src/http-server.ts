import { AsyncLocalStorage } from 'async_hooks';
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import { isIPv4, type AddressInfo } from 'net';
import proxyAddr from 'proxy-addr';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { ipv6Groups, type EngineLogger } from '@sci-open/core';
import { createHttpHandler } from './http';
import { TokenBucket } from './admission';
import { AdmissionError } from './errors';
import type { HttpConfig } from './config';
import type { ServerDeps } from './server';
import { BUILD } from './build-info';

/**
 * sci-open-mcp over Streamable HTTP, on its own: `sci-open-mcp --http`.
 *
 * What a shared endpoint needs beyond the handler, each for a reason:
 *
 * - **Two budgets per client.** Every request spends the route's allowance
 *   (`requestsPerMinute`): a tools/list or a page of a held set is cheap, not
 *   free. A call that resolves something new — a search, a count, a DOI
 *   lookup, a page of a set no longer held — also spends the client's
 *   new-search budget, which is what stands between one script and every
 *   source's daily quota. A process-wide budget alone would let one client
 *   spend everyone's.
 * - **A ceiling over every client.** Per-client budgets bound one client, not
 *   a thousand, or one posing as a thousand. New searches across all clients
 *   also spend `totalNewSearchesPerMinute`, after the client's own budget: a
 *   client past its own spends nothing of everyone's, and a call the ceiling
 *   refuses gets the client's token back.
 * - **The client is the visitor, not the proxy.** Behind a reverse proxy every
 *   request comes from the proxy's address, which would make both budgets one
 *   bucket for everybody. X-Forwarded-For is believed only from the hops named
 *   in `trustProxy`, walking it from the right, as Fastify and Express do; a
 *   value a client wrote itself sits further left and is never read. An IPv6
 *   visitor is its /64 (`clientKey`).
 * - **Browsers.** A request carrying an `Origin` — only a browser sends one —
 *   is refused unless its hostname is allowed, so a page elsewhere cannot
 *   drive the server from a visitor's browser. Bound to loopback, the `Host`
 *   header must name loopback too: the spec's DNS-rebinding defence.
 * - **Stateless.** Any instance answers any request; a search handle carries
 *   its search. Writes are always refused: `save_to` names a path on the
 *   caller's machine.
 */

/** The largest body read: 200 references or papers of 300 characters, with room. */
const MAX_BODY_BYTES = 256 * 1024;
/** Clients remembered for their budgets before the idlest are forgotten. */
const MAX_CLIENTS = 10_000;

export type HttpServerOptions = {
  /** Everything but the logger, which is `logger` below. */
  deps: Omit<ServerDeps, 'transport' | 'admit' | 'logger'>;
  http: HttpConfig;
  newSearchesPerMinute: number;
  logger: EngineLogger;
};

export type RunningHttpServer = { url: string; close(): Promise<void> };

/**
 * The key a client's budgets are kept under: its IPv4 address, or the /64 its
 * IPv6 address is in. A host is handed a /64 at the least and may send from
 * any address in it, so keyed by address one host would hold 2^64 budgets
 * and forget every other client's past `MAX_CLIENTS`. A network handed a /56
 * or a /48 still holds 256 or 65,536 keys; the ceiling over every client is
 * what bounds that. An IPv4 address a dual-stack socket reports as IPv6
 * (`::ffff:203.0.113.7`) is that IPv4 address.
 */
export function clientKey(address: string): string {
  if (isIPv4(address)) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map(g => g.toString(16)).join(':')}::/64`;
}

/** One budget per client key, the least recently seen forgotten past `MAX_CLIENTS`. */
function perClient(perMinute: number): (client: string) => TokenBucket {
  const buckets = new Map<string, TokenBucket>();
  return client => {
    let bucket = buckets.get(client);
    if (bucket) buckets.delete(client);
    else bucket = new TokenBucket(perMinute);
    buckets.set(client, bucket); // most recent last
    if (buckets.size > MAX_CLIENTS) buckets.delete(buckets.keys().next().value!);
    return bucket;
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export async function startHttpServer({ deps, http, newSearchesPerMinute, logger }: HttpServerOptions): Promise<RunningHttpServer> {
  const trust = proxyAddr.compile(http.trustProxy);
  const clientOf = (req: IncomingMessage) => clientKey(proxyAddr(req, trust));

  const requestBudget = perClient(http.requestsPerMinute);
  const searchBudget = perClient(newSearchesPerMinute);
  const everyone = new TokenBucket(http.totalNewSearchesPerMinute);

  // The handler is built once; the client is known per request. Each MCP
  // request runs in its own store, which `admit` reads however deep in a
  // tool it is called.
  const current = new AsyncLocalStorage<string>();
  const admit = async () => {
    const client = current.getStore();
    if (client === undefined) throw new Error('admit was called outside an HTTP request');
    const own = searchBudget(client);
    own.take();
    try {
      everyone.take();
    } catch (error) {
      own.giveBack();
      throw error;
    }
  };

  const handler = createHttpHandler(
    { ...deps, config: { ...deps.config, allowWrites: false }, admit, logger },
    // The message only: a request can hold a query or a reference.
    { onerror: error => logger.warn({ err: error.message }, 'MCP request failed'), maxRequestBodySize: MAX_BODY_BYTES }
  );
  const node = toNodeHandler(handler, {
    maxRequestBodySize: MAX_BODY_BYTES,
    onerror: error => logger.error({ err: error.message }, 'MCP handler threw')
  });
  const originAllowed = originValidation([...http.allowedOrigins]);
  const hostAllowed = LOOPBACK.has(http.host) ? hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']) : undefined;

  const server = createNodeServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;

      // The version, not the user agent: that carries the operator's contact address.
      if (path === '/health' && req.method === 'GET') return json(res, 200, { status: 'ok', version: BUILD.version });

      if (path === '/metrics' && req.method === 'GET') {
        if (!http.adminKey) return json(res, 404, { error: 'Not found' });
        const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        if (!sameSecret(given, http.adminKey)) return json(res, 401, { error: 'Unauthorized' });
        return json(res, 200, { data: deps.metrics.snapshot(), timestamp: new Date().toISOString() });
      }

      if (path !== '/mcp') return json(res, 404, { error: 'Not found' });

      if (hostAllowed && !hostAllowed(req, res)) return;
      if (!originAllowed(req, res)) return;

      const client = clientOf(req);
      try {
        requestBudget(client).take();
      } catch (error) {
        const wait = error instanceof AdmissionError ? error.retryAfterSeconds ?? 60 : 60;
        return json(
          res, 429,
          { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Too many requests. Retry in ${wait} s.` } },
          { 'retry-after': String(wait) }
        );
      }
      await current.run(client, () => node(req, res));
    })().catch(error => {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'HTTP request failed');
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(http.port, http.host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const host = http.host.includes(':') ? `[${http.host}]` : http.host;

  return {
    url: `http://${host}:${port}/mcp`,
    async close() {
      // In-flight exchanges are aborted, then every socket closed: an open
      // SSE stream or an idle keep-alive would otherwise hold the close.
      await handler.close();
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  };
}
