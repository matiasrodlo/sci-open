import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { HttpClientFactory, MAX_RESPONSE_BYTES } from '../http-client-factory';

/**
 * There are two key spaces in this factory and they are not the same.
 *
 * `clients` is keyed by the **full** base URL, because several services live
 * under a path — NCBI's `/entrez/eutils`, OpenAIRE's `/search`, CORE's `/v3` —
 * and normalising that away made axios resolve every request against the bare
 * host. `metrics` is keyed by the **normalised** origin, so that per-host
 * figures are per host.
 *
 * Every write to `metrics` therefore has to go through `normalizeUrl`, and the
 * two below are the places that did not.
 */

// A base URL with a path, which is where the two key spaces diverge. Eight of
// the thirteen configured services have one.
const WITH_PATH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const ORIGIN = 'https://eutils.ncbi.nlm.nih.gov';

let factory: HttpClientFactory | undefined;

const build = () => {
  factory = new HttpClientFactory();
  return factory;
};

afterEach(async () => {
  // Destroys the keep-alive agents, so no handle outlives the test.
  await factory?.closeAllConnections();
  factory = undefined;
});

describe('metrics keying', () => {
  it('registers a client under its origin, not its full base URL', () => {
    const f = build();
    f.getClient(WITH_PATH);

    expect([...(f.getMetrics() as Map<string, unknown>).keys()]).toEqual([ORIGIN]);
  });

  it('keeps metrics reachable after a reset of every client', () => {
    // `resetMetrics()` cleared the map and then re-registered from the *client*
    // keys, which carry the path. Every service with a path ended up with an
    // entry under a key `updateMetrics` never looks up, and its
    // `if (!metrics) return` then dropped every later measurement for them —
    // silently, and for the life of the process.
    const f = build();
    f.getClient(WITH_PATH);

    f.resetMetrics();

    expect(f.getMetrics(WITH_PATH)).not.toBeNull();
    expect([...(f.getMetrics() as Map<string, unknown>).keys()]).toEqual([ORIGIN]);
  });

  it('does not zero a host counters when a second client on it is built', () => {
    // Two base URLs on one host share a metrics key. OpenAlex already drives
    // two code paths against `api.openalex.org`, and either service is one
    // endpoint away from needing a second base URL with a different path.
    const f = build();
    f.getClient('https://api.openalex.org');

    const metrics = f.getMetrics('https://api.openalex.org')!;
    metrics.totalRequests = 5;

    f.getClient('https://api.openalex.org/v2');

    expect(f.getMetrics('https://api.openalex.org')!.totalRequests).toBe(5);
  });

  it('reuses one client per full base URL', () => {
    const f = build();
    expect(f.getClient(WITH_PATH)).toBe(f.getClient(WITH_PATH));
  });

  it('keeps the path on the client, which is what axios resolves against', () => {
    const f = build();
    expect(f.getClient(WITH_PATH).defaults.baseURL).toBe(WITH_PATH);
  });
});

/**
 * What the counters say about how an upstream answered, against a real server
 * on loopback. They used to count every status below 500 as a success — so an
 * upstream answering 429 all day showed an error rate of zero — and to read
 * connection reuse off a response header.
 */
describe('metrics counting', () => {
  let server: http.Server;
  let base: string;
  /** Statuses to answer with, per path, in order; the last one repeats. */
  const script = new Map<string, number[]>();

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const statuses = script.get(request.url ?? '') ?? [200];
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      response.writeHead(status, { 'content-type': 'application/json', connection: 'keep-alive' });
      response.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const metricsFor = (f: HttpClientFactory) => f.getMetrics(base)!;

  it('counts a rate limit as unserved, and a 404 as an answer', async () => {
    const f = build();
    script.set('/limited', [429]);
    script.set('/missing', [404]);
    const client = f.getClient(base, { retryAttempts: 0 });

    await client.get('/limited');
    await client.get('/missing');
    await client.get('/ok');

    const m = metricsFor(f);
    expect(m).toMatchObject({ totalRequests: 3, succeeded: 1, rateLimited: 1, clientErrors: 1 });
    expect(m.errorRate).toBeCloseTo(1 / 3);
  });

  it('counts a retried request once per attempt', async () => {
    const f = build();
    script.set('/flaky', [503, 200]);
    const client = f.getClient(base, { retryAttempts: 2, retryDelay: 1 });

    expect((await client.get('/flaky')).status).toBe(200);
    expect(metricsFor(f)).toMatchObject({ totalRequests: 2, serverErrors: 1, succeeded: 1 });
  });

  it('knows a reused socket from a new one by the socket, not by a header', async () => {
    const f = build();
    const client = f.getClient(base, { retryAttempts: 0 });

    await client.get('/one');
    await client.get('/two');

    expect(metricsFor(f)).toMatchObject({ newConnections: 1, reusedConnections: 1 });
  });

  it('tells a failure from an abort, and blames the upstream only for the first', async () => {
    const f = build();
    const refused = 'http://127.0.0.1:1';
    await f.getClient(refused, { retryAttempts: 0 }).get('/').catch(() => undefined);
    expect(f.getMetrics(refused)).toMatchObject({ totalRequests: 1, failed: 1, errorRate: 1 });

    const controller = new AbortController();
    controller.abort();
    await f.getClient(base, { retryAttempts: 0 }).get('/', { signal: controller.signal }).catch(() => undefined);
    expect(metricsFor(f)).toMatchObject({ totalRequests: 1, aborted: 1, errorRate: 0 });
  });
});

/**
 * No upstream answer is read past a fixed size.
 *
 * Every pooled client was created without `maxContentLength`, and axios's
 * Node default is unlimited, so one provider or authority answering with a
 * runaway body could make the API buffer all of it. The largest page measured
 * across the fan-out, on 2026-10-01, was an OpenAlex page of 200 works at
 * 9.3 MB; the cap is several times that.
 */
describe('response size', () => {
  it('caps what a pooled client will read', () => {
    const client = build().getClient('https://api.example.org', { retryAttempts: 0 });
    expect(client.defaults.maxContentLength).toBe(MAX_RESPONSE_BYTES);
    expect(MAX_RESPONSE_BYTES).toBeGreaterThan(5 * 9_305_138);
  });

  it('refuses a body one byte over the cap rather than buffering it', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      let sent = 0;
      const pump = () => {
        while (sent <= MAX_RESPONSE_BYTES) {
          sent += chunk.length;
          if (!response.write(chunk)) return void response.once('drain', pump);
        }
        response.end();
      };
      pump();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const error = await build().getClient(base, { retryAttempts: 0, timeout: 20000 }).get('/big').catch(e => e);
      expect(String(error?.message)).toMatch(/maxContentLength/);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }, 20000);
});
