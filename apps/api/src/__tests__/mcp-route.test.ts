import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Paper } from '@open-access-explorer/shared';
import type { ProviderEntry } from '@open-access-explorer/core';
import { paper, ref } from '@open-access-explorer/core/testing';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { CacheManager } from '../lib/cache-manager';

/**
 * `/api/mcp`, through Fastify and the real SDK on both sides — a client over a
 * socket, as the Inspector or Claude would connect — against a fake provider.
 *
 * What only this level can show: that the per-client budget reaches a tool
 * through the SDK (the request's store has to survive the adapter, the
 * handler and the server instance between them), that the endpoint refuses
 * to mount without an OpenAlex key, and what goes over the wire when a client
 * asks for progress and when it does not.
 */

vi.mock('ioredis', () => {
  class FakeRedis {
    store = new Map<string, string>();
    constructor(_url: string, _options: unknown = {}) {}
    async get(key: string) { return this.store.get(key) ?? null; }
    async setex(key: string, _ttl: number, value: string) { this.store.set(key, value); return 'OK'; }
    async del(...keys: string[]) { return keys.filter(key => this.store.delete(key)).length; }
    async scan() { return ['0', []] as [string, string[]]; }
    on() { return this; }
    async quit() { return 'OK'; }
  }
  return { default: FakeRedis };
});

const ADMIN_KEY = 'test-admin-key';

/** Mounted and keyed, with the startup notices answered, over whatever a test sets. */
const ENABLED = { MCP_HTTP_ENABLED: 'true', OPENALEX_API_KEY: 'test-openalex-key' };

const record = (i: number): Paper =>
  paper({
    id: `europepmc:${i}`,
    title: `Study ${i}`,
    doi: `10.1/e-${i}`,
    year: 2020 + i,
    sources: [ref('europepmc', { nativeId: String(i), rank: i })]
  });

/** A provider that answers every search with three papers, and records each query. */
function provider() {
  const searches: string[] = [];
  const papers = [record(0), record(1), record(2)];
  const entry: ProviderEntry = {
    id: 'europepmc',
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: query => query.terms.join(' '),
    normalizerVersion: 1,
    search: async ({ query }) => {
      searches.push(query.terms.join(' '));
      return { papers, totalHits: papers.length, skipped: [] };
    },
    lookup: async ({ nativeId }) => papers.find(p => p.sources[0]!.nativeId === nativeId) ?? null
  };
  return { entry, searches };
}

let app: FastifyInstance | undefined;
const clients: Client[] = [];

/** The app, with error-level log lines collected so a test can read them. */
function build(env: Record<string, string> = {}, entry: ProviderEntry = provider().entry) {
  const config = loadConfig({
    TRUST_PROXY: 'loopback', ADMIN_API_KEY: ADMIN_KEY, UNPAYWALL_EMAIL: 'ops@example.org', ...env
  }).config;
  const lines: string[] = [];
  app = buildApp({
    config,
    cache: new CacheManager(config.redisUrl, config.cache.maxBytes, config.cache.redisCooldownMs),
    providers: [entry],
    authorities: [],
    logger: { level: 'error', stream: { write: (line: string) => void lines.push(line) } }
  });
  return { app, errors: () => lines.map(line => JSON.parse(line).msg as string) };
}

/** A JSON-RPC POST, as curl would send it. */
const post = (body: object, headers: Record<string, string> = {}, url = '/api/mcp') =>
  app!.inject({
    method: 'POST', url, payload: body,
    headers: { accept: 'application/json, text/event-stream', ...headers }
  });

const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

/**
 * A client connected over a real socket. `forwardedFor` is the visitor's
 * address as the web tier passes it on; `era` picks the protocol revision.
 * Every response's content type is recorded, so a test can see whether it
 * was answered as JSON or as a stream.
 */
async function connect(options: { forwardedFor?: string; era?: 'modern' | 'legacy'; query?: string } = {}) {
  const address = await app!.listen({ port: 0, host: '127.0.0.1' }).catch(() => serverAddress());
  const contentTypes: string[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(`${address}/api/mcp${options.query ?? ''}`), {
    requestInit: { headers: options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {} },
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      contentTypes.push(response.headers.get('content-type') ?? '');
      return response;
    }
  });
  const client = new Client(
    { name: 'mcp-route-test', version: '0.0.0' },
    options.era === 'legacy' ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await client.connect(transport);
  clients.push(client);
  return { client, contentTypes };
}

/** The address of a server already listening: a second `connect` in one test. */
function serverAddress(): string {
  const bound = app!.server.address();
  if (!bound || typeof bound === 'string') throw new Error('not listening');
  return `http://127.0.0.1:${bound.port}`;
}

const textOf = (result: { content: unknown }) =>
  (result.content as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text).join('\n');

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close().catch(() => {})));
  await app?.close();
  app = undefined;
});

describe('mounting /api/mcp', () => {
  it('is not mounted unless MCP_HTTP_ENABLED is true', async () => {
    build({ OPENALEX_API_KEY: 'test-openalex-key' });
    expect((await post(LIST_TOOLS)).statusCode).toBe(404);
    expect((await app!.inject({ method: 'GET', url: '/api/performance/mcp', headers: { authorization: `Bearer ${ADMIN_KEY}` } })).statusCode).toBe(404);
  });

  it('stays off without an OpenAlex key, and says why in the log', async () => {
    // Unkeyed, every MCP client and the web UI would share a tenth of a key's
    // daily budget. A warning would be read after it was gone.
    const { errors } = build({ MCP_HTTP_ENABLED: 'true' });
    expect((await post(LIST_TOOLS)).statusCode).toBe(404);
    await app!.ready();
    expect(errors()).toEqual([expect.stringMatching(/^MCP_HTTP_ENABLED is true but OPENALEX_API_KEY is unset/)]);
  });

  it('mounts without the key only when told to, for a trial', async () => {
    const { errors } = build({ MCP_HTTP_ENABLED: 'true', MCP_ALLOW_UNKEYED: 'true' });
    expect((await post(LIST_TOOLS)).statusCode).toBe(200);
    expect(errors()).toEqual([]);
  });
});

describe('POST /api/mcp', () => {
  it('answers a 2026-07-28 client: discovery, then the tools', async () => {
    build(ENABLED);
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: 'sci-open' });
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper']);
  });

  it('answers server/discover as curl would send it, with the headers the revision requires', async () => {
    build(ENABLED);
    const discovered = await post(
      {
        jsonrpc: '2.0', id: 1, method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'curl', version: '0' }
          }
        }
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' }
    );
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().result.supportedVersions).toContain('2026-07-28');
  });

  it('serves a 2025-era client from the same tools, statelessly', async () => {
    build(ENABLED);
    const { client } = await connect({ era: 'legacy' });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    // No session to stream or to end: GET and DELETE are the 2025 session operations.
    expect((await app!.inject({ method: 'GET', url: '/api/mcp', headers: { accept: 'text/event-stream' } })).statusCode).toBe(405);
    expect((await app!.inject({ method: 'DELETE', url: '/api/mcp' })).statusCode).toBe(405);
  });

  it('takes the toolsets from the URL, and names the valid ones for a typo', async () => {
    build(ENABLED);
    const { client } = await connect({ query: '?toolsets=core' });
    expect((await client.listTools()).tools.map(t => t.name)).not.toContain('read_paper');

    const typo = await post(LIST_TOOLS, {}, '/api/mcp?toolsets=nope');
    expect(typo.statusCode).toBe(400);
    expect(typo.json().error.message).toMatch(/^Unknown toolset "nope"\. Toolsets: core, read, graph, export\./);
  });

  it('refuses a browser on an origin it was not told to allow', async () => {
    // A page elsewhere must not drive this endpoint from a visitor's browser.
    build({ ...ENABLED, MCP_ALLOWED_ORIGINS: 'app.example.org' });
    expect((await post(LIST_TOOLS, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post(LIST_TOOLS, { origin: 'https://app.example.org' })).statusCode).toBe(200);
    // Every MCP client that is not a browser sends no Origin, and passes.
    expect((await post(LIST_TOOLS)).statusCode).toBe(200);
  });

  it('refuses every browser origin when none is configured', async () => {
    build(ENABLED);
    expect((await post(LIST_TOOLS, { origin: 'http://localhost:3000' })).statusCode).toBe(403);
  });

  it('never writes a file, and refuses before reading anything', async () => {
    const { entry, searches } = provider();
    const lookup = vi.spyOn(entry, 'lookup');
    build(ENABLED, entry);
    const { client } = await connect();
    const result = await client.callTool({ name: 'read_paper', arguments: { paper: 'europepmc:1', save_to: '/tmp/sci-open-mcp-test' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error \(writes_disabled\)/);
    expect(lookup).not.toHaveBeenCalled();
    expect(searches).toEqual([]);
  });

  it('charges each client its own new searches, from the budget the web UI spends', async () => {
    // RATE_LIMIT_NEW_SEARCH_MAX is per caller, and the caller is the visitor
    // the web tier names. Proving it also proves the request reaches the
    // tool through the SDK: a process-wide fallback would refuse b's search.
    const { entry, searches } = provider();
    build({ ...ENABLED, RATE_LIMIT_NEW_SEARCH_MAX: '1' }, entry);
    const a = (await connect({ forwardedFor: '203.0.113.1' })).client;
    const b = (await connect({ forwardedFor: '203.0.113.2' })).client;

    const first = await a.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } });
    expect(first.isError).toBeFalsy();
    // A page of a held set is a slice, and costs nothing.
    const handle = (first.structuredContent as { handle: string }).handle;
    expect((await a.callTool({ name: 'get_search_page', arguments: { handle, page: 1 } })).isError).toBeFalsy();

    const refused = await a.callTool({ name: 'search_papers', arguments: { query: 'TS=malaria' } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^Error \(rate_limited\): Too many new searches\. Retry in \d+ s\./);

    expect((await b.callTool({ name: 'search_papers', arguments: { query: 'TS=cholera' } })).isError).toBeFalsy();
    expect(searches).toEqual(['crispr', 'cholera']);

    // The same visitor in a browser has nothing left either.
    const fromBrowser = await app!.inject({
      method: 'POST', url: '/api/search', payload: { q: 'dengue' }, headers: { 'x-forwarded-for': '203.0.113.1' }
    });
    expect(fromBrowser.statusCode).toBe(429);
  });

  it('streams progress to a client that asked for it, and answers one JSON body to one that did not', async () => {
    build(ENABLED);
    const { client, contentTypes } = await connect();

    contentTypes.length = 0;
    const quiet = await client.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } });
    expect(quiet.isError).toBeFalsy();
    expect(contentTypes).toEqual([expect.stringMatching(/^application\/json/)]);

    contentTypes.length = 0;
    const progress: string[] = [];
    const asked = await client.callTool(
      { name: 'search_papers', arguments: { query: 'TS=malaria' } },
      { onprogress: p => progress.push(p.message ?? '') }
    );
    expect(asked.isError).toBeFalsy();
    expect(progress).toContain('europepmc answered (1 of 1 sources)');
    expect(contentTypes).toEqual([expect.stringMatching(/^text\/event-stream/)]);
  });
});

describe('GET /api/performance/mcp', () => {
  it('counts calls per tool, for the admin key only, and holds no query', async () => {
    build(ENABLED);
    const { client } = await connect();
    await client.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } });

    const metrics = (key?: string) => app!.inject({
      method: 'GET', url: '/api/performance/mcp', ...(key ? { headers: { authorization: `Bearer ${key}` } } : {})
    });
    expect((await metrics()).statusCode).toBe(401);

    const snapshot = await metrics(ADMIN_KEY);
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.tools.search_papers).toMatchObject({ calls: 1, newSearches: 1, errors: {} });
    expect(snapshot.body).not.toContain('crispr');
  });
});
