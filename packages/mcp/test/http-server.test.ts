import { describe, it, expect, afterEach } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { paper, ref } from '@open-access-explorer/core/testing';
import { startHttpServer, type RunningHttpServer } from '../src/http-server';
import { createMetrics } from '../src/metrics';
import type { HttpConfig } from '../src/config';
import type { Engine } from '@open-access-explorer/core';
import { fixtureEngine } from '../src/fixture-engine';
import { fakeEngine } from './fake-engine';
import { FIXTURES } from './fixtures';

/**
 * `sci-open-mcp --http`, over a real socket, with the SDK's own client in both
 * protocol eras, against a fake engine. What only this level shows: that a
 * client's budget reaches a tool through the adapter, the handler and the
 * server instance between them; that the client is the visitor a trusted
 * proxy names and nobody else; and what goes over the wire.
 */

const PAPERS = [1, 2, 3].map(i =>
  paper({ id: `openalex:W${i}`, doi: `10.1234/s.${i}`, title: `Crispr malaria cholera dengue study ${i}`, year: 2020, sources: [ref('openalex', { nativeId: `W${i}` })] })
);

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
let running: RunningHttpServer | undefined;
const clients: Client[] = [];

async function serve(http: Partial<HttpConfig> = {}, newSearchesPerMinute = 30, engine?: Engine) {
  const fake = fakeEngine(PAPERS);
  const metrics = createMetrics(quiet);
  running = await startHttpServer({
    deps: { engine: engine ?? fake.engine, config: { ...fake.deps.config, allowWrites: true }, metrics },
    http: { host: '127.0.0.1', port: 0, allowedOrigins: [], trustProxy: [], requestsPerMinute: 60, allowUnkeyed: false, ...http },
    newSearchesPerMinute,
    logger: quiet
  });
  return { url: running.url, searches: fake.searches, metrics };
}

async function connect(url: string, options: { forwardedFor?: string; era?: 'modern' | 'legacy'; query?: string } = {}) {
  const contentTypes: string[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(`${url}${options.query ?? ''}`), {
    requestInit: { headers: options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {} },
    fetch: async (u, init) => {
      const response = await fetch(u, init);
      contentTypes.push(response.headers.get('content-type') ?? '');
      return response;
    }
  });
  const client = new Client({ name: 'http-server-test', version: '0.0.0' },
    options.era === 'legacy' ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(transport);
  clients.push(client);
  return { client, contentTypes };
}

const post = (url: string, body: object, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });

const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const textOf = (result: { content: unknown }) =>
  (result.content as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text).join('\n');

afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close().catch(() => {})));
  await running?.close();
  running = undefined;
});

describe('sci-open-mcp --http', () => {
  it('serves a 2026-07-28 client at /mcp: discovery, then the default tools', async () => {
    const { url } = await serve();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const { client } = await connect(url);
    expect(client.getServerVersion()).toMatchObject({ name: 'sci-open' });
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper']);
  });

  it('answers server/discover as curl sends it, with the headers the revision requires', async () => {
    const { url } = await serve();
    const response = await post(url, {
      jsonrpc: '2.0', id: 1, method: 'server/discover',
      params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'curl', version: '0' }
      } }
    }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' });
    expect(response.status).toBe(200);
    expect((await response.json()).result.supportedVersions).toContain('2026-07-28');
  });

  it('serves a 2025-era client statelessly, so the session operations answer 405', async () => {
    const { url } = await serve();
    const { client } = await connect(url, { era: 'legacy' });
    expect((await client.listTools()).tools).toHaveLength(5);
    expect((await fetch(url, { headers: { accept: 'text/event-stream' } })).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  });

  it('takes toolsets from the URL, names the valid ones for a typo, and never writes', async () => {
    const { url } = await serve();
    const { client } = await connect(url, { query: '?toolsets=all' });
    expect((await client.listTools()).tools).toHaveLength(7);
    const refused = await client.callTool({ name: 'export_citations', arguments: { papers: ['10.1234/s.1'], save_to: '/tmp/sci-open-x' } });
    expect(textOf(refused)).toMatch(/^Error \(writes_disabled\)/);

    const typo = await post(`${url}?toolsets=nope`, LIST_TOOLS);
    expect(typo.status).toBe(400);
    expect((await typo.json()).error.message).toMatch(/^Unknown toolset "nope"/);
  });

  it('refuses a browser on an origin it was not told to allow, and passes clients that send none', async () => {
    const { url } = await serve({ allowedOrigins: ['app.example.org'] });
    expect((await post(url, LIST_TOOLS, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(url, LIST_TOOLS, { origin: 'https://app.example.org' })).status).toBe(200);
    expect((await post(url, LIST_TOOLS)).status).toBe(200);
  });

  it('bound to loopback, refuses a Host that is not: the DNS-rebinding defence', async () => {
    const { url } = await serve();
    const { port } = new URL(url);
    // fetch will not send a forged Host; a raw request will.
    const { request } = await import('http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, res => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(JSON.stringify(LIST_TOOLS));
    });
    expect(status).toBe(403);
  });

  it('charges each client its own new searches, the client being the visitor a trusted proxy names', async () => {
    const { url, searches } = await serve({ trustProxy: ['loopback'] }, 1);
    const a = (await connect(url, { forwardedFor: '203.0.113.1' })).client;
    const b = (await connect(url, { forwardedFor: '203.0.113.2' })).client;

    expect((await a.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } })).isError).toBeFalsy();
    const refused = await a.callTool({ name: 'search_papers', arguments: { query: 'TS=malaria' } });
    expect(textOf(refused)).toMatch(/^Error \(rate_limited\): Too many new searches\. Retry in \d+ s\./);
    expect((await b.callTool({ name: 'search_papers', arguments: { query: 'TS=cholera' } })).isError).toBeFalsy();
    expect(searches).toEqual(['TS=crispr', 'TS=cholera']);
  });

  it('does not believe X-Forwarded-For from a hop it was not told to trust', async () => {
    const { url } = await serve({}, 1);
    const a = (await connect(url, { forwardedFor: '203.0.113.1' })).client;
    const b = (await connect(url, { forwardedFor: '203.0.113.2' })).client;
    expect((await a.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } })).isError).toBeFalsy();
    // Both are this test's socket, whatever they claim: one budget.
    expect(textOf(await b.callTool({ name: 'search_papers', arguments: { query: 'TS=dengue' } }))).toMatch(/^Error \(rate_limited\)/);
  });

  it('answers 429 with Retry-After past a client’s requests a minute', async () => {
    const { url } = await serve({ requestsPerMinute: 2 });
    expect((await post(url, LIST_TOOLS)).status).toBe(200);
    expect((await post(url, LIST_TOOLS)).status).toBe(200);
    const third = await post(url, LIST_TOOLS);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('streams progress to a client that asked for it, and one JSON body to one that did not', async () => {
    // The fixture engine replays each source's report as progress.
    const { url } = await serve({}, 30, fixtureEngine(FIXTURES));
    const { client, contentTypes } = await connect(url);

    contentTypes.length = 0;
    expect((await client.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } })).isError).toBeFalsy();
    expect(contentTypes).toEqual([expect.stringMatching(/^application\/json/)]);

    contentTypes.length = 0;
    const progress: string[] = [];
    await client.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } }, { onprogress: p => progress.push(p.message ?? '') });
    expect(progress.length).toBeGreaterThan(0);
    expect(contentTypes).toEqual([expect.stringMatching(/^text\/event-stream/)]);
  });

  it('answers /health, serves /metrics to the admin key only, and 404 elsewhere', async () => {
    const { url } = await serve({ adminKey: 'secret-admin-key' });
    const base = url.replace(/\/mcp$/, '');
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const { client } = await connect(url);
    await client.callTool({ name: 'search_papers', arguments: { query: 'TS=crispr' } });
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    const metrics = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer secret-admin-key' } });
    expect(metrics.status).toBe(200);
    const body = await metrics.text();
    expect(JSON.parse(body).data.tools.search_papers).toMatchObject({ calls: 1, newSearches: 1 });
    expect(body).not.toContain('crispr');

    expect((await fetch(`${base}/api/mcp`, { method: 'POST' })).status).toBe(404);
  });

  it('hides /metrics when no admin key is set', async () => {
    const { url } = await serve();
    expect((await fetch(url.replace(/\/mcp$/, '/metrics'))).status).toBe(404);
  });
});
