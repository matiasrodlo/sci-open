import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { HttpClientFactory } from '../http-client-factory';
import { measureUpstream, sourceOf, upstreamUsage, usageSince, recordUpstream } from '../upstream-usage';

/** A local server: `/priced` answers as OpenAlex does, with its price in
 * `meta`; `/limited` refuses with a 429; `/flaky` fails once with a 503. */
async function serve(): Promise<{ base: string; close: () => Promise<void> }> {
  let flaky = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/priced') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ meta: { cost_usd: 0.0001 }, results: [] }));
    else if (req.url === '/limited') res.writeHead(429).end();
    else if (req.url === '/flaky') res.writeHead(flaky++ === 0 ? 503 : 200, { 'content-type': 'application/json' }).end('{}');
    else res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(() => resolve())) };
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup) await step();
  cleanup = [];
});

function client(base: string) {
  const c = new HttpClientFactory({ retryDelay: 1 }).getClient(base);
  cleanup.push(() => { c.defaults.httpAgent?.destroy(); c.defaults.httpsAgent?.destroy(); });
  return c;
}

describe('upstream usage', () => {
  it('counts every request a pooled client sends — each retry, each failure, each rate limit — and OpenAlex’s price', async () => {
    const { base, close } = await serve();
    cleanup.push(close);
    const http = client(base);
    const before = upstreamUsage();

    const measured = measureUpstream(async () => {
      await http.get('/priced');
      await http.get('/priced');
      await http.get('/limited'); // a 4xx resolves: the pool reads it rather than throwing
      await http.get('/flaky'); // a 503, then the retry's 200
    });
    await measured.done;

    expect(measured.usage()).toEqual({
      requests: 5,
      costUsd: 0.0002,
      sources: { 'full-text': { requests: 5, failed: 2, rateLimited: 1, costUsd: 0.0002 } }
    });
    // The process's own count moved by the same.
    expect(usageSince(upstreamUsage(), before)).toEqual(measured.usage());
  });

  it('charges each request to the call that made it, not to one running beside it', async () => {
    const first = measureUpstream(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      recordUpstream('https://api.openalex.org/works', { status: 200, costUsd: 0.001 });
    });
    const second = measureUpstream(async () => {
      recordUpstream('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', { status: 429 });
    });
    await Promise.all([first.done, second.done]);

    expect(first.usage().sources).toEqual({ openalex: { requests: 1, failed: 0, rateLimited: 0, costUsd: 0.001 } });
    expect(second.usage().sources).toEqual({ ncbi: { requests: 1, failed: 1, rateLimited: 1, costUsd: 0 } });
  });

  it('says what a call asked even when it failed', async () => {
    const measured = measureUpstream(async () => {
      recordUpstream('https://api.openalex.org/works', { status: 200, costUsd: 0.001 });
      throw new Error('after one request');
    });
    await expect(measured.done).rejects.toThrow('after one request');
    expect(measured.usage().requests).toBe(1);
  });

  it('names a source by its host, and any other host as a full text', () => {
    expect(sourceOf('https://api.openalex.org/works?filter=x')).toBe('openalex');
    expect(sourceOf('https://export.arxiv.org/api/query')).toBe('arxiv');
    expect(sourceOf('https://www.ebi.ac.uk/europepmc/webservices/rest/search')).toBe('europepmc');
    expect(sourceOf('https://www.publisher.example/article.pdf')).toBe('full-text');
    expect(sourceOf(undefined)).toBe('unknown');
  });
});
