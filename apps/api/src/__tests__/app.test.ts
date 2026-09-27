import { describe, it, expect, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import { AxiosError } from 'axios';
import type { FastifyInstance } from 'fastify';
import type { Paper } from '@open-access-explorer/shared';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { CacheManager } from '../lib/cache-manager';
import type { ProviderEntry } from '../orchestrator/registry';
import { paper, ref } from '../orchestrator/__tests__/helpers';

/**
 * The routes, through Fastify, with nothing past the process boundary: the
 * providers are fakes, the authorities are none, and Redis is a Map.
 *
 * There were no tests at this level while the server built itself on import.
 * Everything below had to be checked by hand against a running service — the
 * rate limiter most of all, which was once silently off for every route because
 * of the order plugins and routes were registered in.
 */

vi.mock('ioredis', () => {
  class FakeRedis {
    store = new Map<string, string>();
    constructor(_url: string, _options: unknown = {}) {}
    async get(key: string) { return this.store.get(key) ?? null; }
    async setex(key: string, _ttl: number, value: string) { this.store.set(key, value); return 'OK'; }
    async del(...keys: string[]) {
      let n = 0;
      for (const key of keys) if (this.store.delete(key)) n += 1;
      return n;
    }
    async scan(_cursor: string, _m: string, match: string) {
      const re = new RegExp(`^${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
      return ['0', [...this.store.keys()].filter(k => re.test(k))] as [string, string[]];
    }
    on() { return this; }
    async quit() { return 'OK'; }
  }
  return { default: FakeRedis };
});

/**
 * One publisher that serves a PDF without leaving the process. Every other
 * address goes through the real guard and the real fetch — so the SSRF
 * refusals below are the real ones.
 */
const PUBLISHER = 'https://files.example.org/';

vi.mock('../lib/pdf-proxy', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/pdf-proxy')>();
  return {
    ...actual,
    assertPublicHttpUrl: async (raw: string) =>
      raw.startsWith(PUBLISHER) ? new URL(raw) : actual.assertPublicHttpUrl(raw),
    fetchPdfStream: async (url: URL, userAgent: string) =>
      url.href.startsWith(PUBLISHER)
        ? { stream: Readable.from([Buffer.from('%PDF-1.7 fixture')]), contentLength: 16, filename: 'upstream.pdf' }
        : actual.fetchPdfStream(url, userAgent)
  };
});

const ADMIN_KEY = 'test-admin-key';

/** Settings with the startup notices answered, over whatever a test sets. */
const configWith = (env: Record<string, string> = {}) =>
  loadConfig({ TRUST_PROXY: 'loopback', ADMIN_API_KEY: ADMIN_KEY, UNPAYWALL_EMAIL: 'ops@example.org', ...env }).config;

const record = (i: number): Paper =>
  paper({
    id: `europepmc:${i}`,
    title: `Study ${i}`,
    doi: `10.1/e-${i}`,
    year: 2020 + i,
    sources: [ref('europepmc', { nativeId: String(i), rank: i })]
  });

/** A provider that answers every search with `papers` and every lookup with `lookup`. */
function provider(
  papers: Paper[] = [record(0), record(1), record(2)],
  lookup: ProviderEntry['lookup'] = async ({ nativeId }) => papers.find(p => p.sources[0]!.nativeId === nativeId) ?? null
) {
  const searches: string[] = [];
  const entry: ProviderEntry = {
    id: 'europepmc',
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['published'], filter: false }
    },
    translate: query => query.terms.join(' '),
    normalizerVersion: 1,
    search: async ({ query }) => {
      searches.push(query.terms.join(' '));
      return { papers, totalHits: papers.length, skipped: [] };
    },
    lookup
  };
  return { entry, searches };
}

let app: FastifyInstance | undefined;

function build(env: Record<string, string> = {}, entry: ProviderEntry = provider().entry) {
  const config = configWith(env);
  const cache = new CacheManager(config.redisUrl, config.cache.maxBytes, config.cache.redisCooldownMs);
  app = buildApp({ config, cache, providers: [entry], authorities: [], logger: false });
  return { app, cache };
}

const search = (body: object) => app!.inject({ method: 'POST', url: '/api/search', payload: body });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('rate limiting', () => {
  it('puts every route behind the limit', async () => {
    // Registered on the root instance, the routes were added before the
    // limiter's onRoute hook existed, and 130 requests against a limit of 3
    // all went through with no x-ratelimit headers on any of them.
    build({ RATE_LIMIT_MAX: '2' });

    const first = await search({ q: 'crispr' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('2');

    expect((await search({ q: 'crispr' })).statusCode).toBe(200);

    const third = await search({ q: 'crispr' });
    expect(third.statusCode).toBe(429);
    expect(third.json().message).toMatch(/^Rate limit exceeded/);
  });

  it('never throttles the health check', async () => {
    build({ RATE_LIMIT_MAX: '1' });
    for (let i = 0; i < 3; i++) {
      expect((await app!.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });

  it('gives the download a bucket of its own', async () => {
    build({ RATE_LIMIT_MAX: '1', RATE_LIMIT_DOWNLOAD_MAX: '5' }, provider([
      record(0),
      paper({ ...record(1), fullText: { url: `${PUBLISHER}1.pdf`, kind: 'pdf', verified: false } })
    ]).entry);
    await search({ q: 'crispr' });
    expect((await search({ q: 'crispr' })).statusCode).toBe(429);

    // Served, not refused for the search allowance being spent.
    const download = await app!.inject({ method: 'GET', url: '/api/papers/europepmc%3A1/pdf' });
    expect(download.statusCode).toBe(200);
    expect(download.headers['x-ratelimit-limit']).toBe('5');
  });
});

describe('POST /api/search', () => {
  it('answers from the providers, then from the cache', async () => {
    const { entry, searches } = provider();
    build({}, entry);

    const fresh = await search({ q: 'crispr' });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers['x-cache-hit']).toBe('false');
    const body = fresh.json();
    expect(body.hits.map((hit: { id: string }) => hit.id).sort()).toEqual(['europepmc:0', 'europepmc:1', 'europepmc:2']);
    expect(body.total).toBe(3);
    expect(body.complete).toBe(true);

    const again = await search({ q: 'crispr' });
    expect(again.headers['x-cache-hit']).toBe('true');
    expect(again.json().hits).toEqual(body.hits);
    expect(searches).toEqual(['crispr']);
  });

  it('answers every page and sort of a search from the one set', async () => {
    const papers = Array.from({ length: 45 }, (_, i) => record(i));
    const { entry, searches } = provider(papers);
    build({}, entry);

    const pages = await Promise.all([1, 2, 3].map(page => search({ q: 'crispr', page })));
    const byTitle = await search({ q: 'crispr', sort: 'title' });

    expect(searches).toEqual(['crispr']);
    expect(pages.map(p => p.json().total)).toEqual([45, 45, 45]);
    const ids = pages.flatMap(p => p.json().hits.map((hit: { id: string }) => hit.id));
    expect(new Set(ids).size).toBe(45);
    expect(byTitle.headers['x-cache-hit']).toBe('true');
  });

  it('does not keep an answer a provider failed to contribute to', async () => {
    const failing = provider();
    failing.entry.search = async () => { throw new Error('Europe PMC 503'); };
    build({}, failing.entry);

    const response = await search({ q: 'crispr' });
    expect(response.statusCode).toBe(200);
    expect(response.json().complete).toBe(false);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await search({ q: 'crispr' })).headers['x-cache-hit']).toBe('false');
  });

  it('refuses what the schema does not allow', async () => {
    build();
    expect((await search({ q: 'crispr', pageSize: 1000 })).statusCode).toBe(400);
    expect((await search({ q: 'crispr', sort: 'popularity' })).statusCode).toBe(400);
  });

  it('says where a query the grammar cannot read went wrong', async () => {
    build();
    const response = await search({ q: '"unclosed' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.any(String), position: expect.any(Number) });
  });
});

describe('GET /api/paper/:id', () => {
  const paperAt = (id: string) => app!.inject({ method: 'GET', url: `/api/paper/${encodeURIComponent(id)}` });

  it('returns the record the provider holds under that id', async () => {
    build();
    const response = await paperAt('europepmc:1');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'europepmc:1', title: 'Study 1', source: 'europepmc', sourceId: '1' });
    expect((await paperAt('europepmc:1')).headers['x-cache-hit']).toBe('true');
  });

  it('answers 404 for an id nobody holds', async () => {
    build();
    expect((await paperAt('europepmc:404')).statusCode).toBe(404);
    expect((await paperAt('nosuchsource:1')).statusCode).toBe(404);
  });

  it('answers 504 when the provider is too slow, and 502 when it is down', async () => {
    build({}, provider(undefined, async () => {
      throw new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');
    }).entry);
    expect((await paperAt('europepmc:1')).statusCode).toBe(504);
    await app!.close();

    build({}, provider(undefined, async () => {
      throw new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    }).entry);
    const down = await paperAt('europepmc:1');
    expect(down.statusCode).toBe(502);
    expect(down.json().error).toBe('The request could not be completed');
  });
});

describe('GET /api/papers/:id/pdf', () => {
  const pdfOf = (id: string) => app!.inject({ method: 'GET', url: `/api/papers/${encodeURIComponent(id)}/pdf` });
  const withCopy = (i: number, url: string, over: Partial<Paper> = {}) =>
    paper({ ...record(i), fullText: { url, kind: 'pdf', verified: false }, ...over });

  it('streams the copy the paper record names, as an attachment named for the paper', async () => {
    build({}, provider([withCopy(1, `${PUBLISHER}1.pdf`, { title: 'Épidémiologie du paludisme' })]).entry);

    const response = await pdfOf('europepmc:1');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="Epidemiologie_du_paludisme.pdf"; filename*=UTF-8''${encodeURIComponent('Épidémiologie du paludisme.pdf')}`
    );
    expect(response.headers['cache-control']).toBe('private, max-age=3600');
    expect(response.body).toBe('%PDF-1.7 fixture');
  });

  it('refuses a record whose copy is inside the network, however it is spelled', async () => {
    // The address comes from a record now, not from the caller — and the guard
    // still stands in front of it, in case a provider ever says something odd.
    const internal = ['http://127.0.0.1/x.pdf', 'http://[::ffff:127.0.0.1]/x.pdf', 'http://[::ffff:a9fe:a9fe]/latest'];
    build({}, provider(internal.map((url, i) => withCopy(i, url))).entry);

    for (const [i, url] of internal.entries()) {
      const response = await pdfOf(`europepmc:${i}`);
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error).toMatch(/non-public/);
    }
  });

  it('answers 404 for a paper with no copy, and for one nobody holds', async () => {
    build({}, provider([paper({ ...record(1), fullText: undefined })]).entry);
    expect((await pdfOf('europepmc:1')).json()).toEqual({ error: 'No copy of this paper is known' });
    expect((await pdfOf('europepmc:1')).statusCode).toBe(404);
    expect((await pdfOf('europepmc:404')).statusCode).toBe(404);
  });

  it('answers 504 when the provider holding the paper is too slow to say where the copy is', async () => {
    build({}, provider(undefined, async () => {
      throw new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');
    }).entry);
    expect((await pdfOf('europepmc:1')).statusCode).toBe(504);
  });

  it('no longer fetches a URL the caller names', async () => {
    build();
    const response = await app!.inject({
      method: 'POST', url: '/api/download-pdf', payload: { pdfUrl: `${PUBLISHER}anything.pdf` }
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('administrative routes', () => {
  const metrics = (key?: string) => app!.inject({
    method: 'GET', url: '/api/cache/metrics', ...(key ? { headers: { authorization: `Bearer ${key}` } } : {})
  });

  it('are disabled outright when no key is configured', async () => {
    const config = configWith({ ADMIN_API_KEY: '' });
    app = buildApp({ config, cache: new CacheManager(config.redisUrl), providers: [], authorities: [], logger: false });
    expect((await metrics(ADMIN_KEY)).statusCode).toBe(503);
  });

  it('refuse a missing or wrong key', async () => {
    build();
    expect((await metrics()).statusCode).toBe(401);
    expect((await metrics('guess')).statusCode).toBe(401);
  });

  it('answer the configured key, and clearing makes the next search ask the sources', async () => {
    const { entry, searches } = provider();
    build({}, entry);
    await search({ q: 'crispr' });
    expect((await metrics(ADMIN_KEY)).json().resultSets.entries).toBe(1);

    const cleared = await app!.inject({
      method: 'POST', url: '/api/cache/clear', headers: { authorization: `Bearer ${ADMIN_KEY}` }
    });
    expect(cleared.statusCode).toBe(200);
    expect((await search({ q: 'crispr' })).headers['x-cache-hit']).toBe('false');
    expect(searches).toHaveLength(2);
  });
});
