import { AsyncLocalStorage } from 'async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { AdmissionError, createHttpHandler, type ServerDeps } from 'sci-open-mcp';

type NewSearchLimit = ReturnType<FastifyInstance['createRateLimit']>;

export type McpRouteOptions = {
  deps: Omit<ServerDeps, 'transport' | 'admit'>;
  /** The search route's per-client budget for new result sets. */
  newSearchLimit: NewSearchLimit;
  /** Hostnames a browser may call this endpoint from. A request without an
   * `Origin` — every MCP client that is not a browser — always passes. */
  allowedOrigins: readonly string[];
};

/** Requests a minute per client, on a bucket of the route's own. */
const MCP_REQUESTS_PER_MINUTE = 60;

/**
 * `/api/mcp`: the MCP server over Streamable HTTP, on this app, so it sits
 * behind the same rate limiter, helmet, logging and shutdown as every other
 * route — and under `/api/`, which the web tier already forwards with the
 * visitor's address chain intact.
 *
 * Two budgets, as for a search from the web UI. The route's own bucket counts
 * every request: a tools/list and a page of a held search are cheap, but not
 * free. The new-search budget is the search route's, so an MCP client and a
 * browser at one address draw on one allowance for what is expensive — a
 * fresh fan-out to every source — and a script cannot double its share by
 * speaking MCP.
 *
 * The handler is built once, but that budget is per client, and only the
 * Fastify request knows the client. Each MCP request runs inside its own
 * store, which `admit` reads however deep in a tool it is called. Without it
 * `createServerFactory` would fall back to one bucket for the whole process.
 */
export function mcpRoute(fastify: FastifyInstance, { deps, newSearchLimit, allowedOrigins }: McpRouteOptions): void {
  const current = new AsyncLocalStorage<FastifyRequest>();
  const admit = async () => {
    const request = current.getStore();
    if (!request) throw new Error('admit was called outside an MCP request');
    const verdict = await newSearchLimit(request);
    if (!verdict.isAllowed && verdict.isExceeded) throw new AdmissionError(verdict.ttlInSeconds);
  };

  // The spec's DNS-rebinding defence, and the cross-site one: a page on
  // another origin must not drive this endpoint from a visitor's browser and
  // spend their budget. The SDK's guard answers 403 itself and returns false.
  const originAllowed = originValidation([...allowedOrigins]);
  const handler = createHttpHandler(
    { ...deps, admit },
    // The message only: the request can hold a query or a reference.
    { onerror: error => fastify.log.warn({ err: error.message }, 'MCP request failed') }
  );
  const node = toNodeHandler(handler, {
    onerror: error => fastify.log.error({ err: error.message }, 'MCP handler threw')
  });

  fastify.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/api/mcp',
    config: { rateLimit: { max: MCP_REQUESTS_PER_MINUTE, timeWindow: 60_000 } },
    handler: async (request, reply) => {
      reply.hijack(); // the SDK writes the response itself
      if (!originAllowed(request.raw, reply.raw)) return;
      // Fastify has already read and parsed the JSON body.
      await current.run(request, () => node(request.raw, reply.raw, request.body));
    }
  });

  // In-flight exchanges are aborted and their instances closed with the app.
  fastify.addHook('onClose', async () => handler.close());
}
