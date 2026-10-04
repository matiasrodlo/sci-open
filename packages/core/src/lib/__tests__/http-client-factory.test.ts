import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { AxiosInstance } from 'axios';
import { createPooledClient, getPooledClient, MAX_RESPONSE_BYTES, type PooledClientOptions } from '../http-client-factory';

// A base URL with a path: several services live under one — NCBI's
// `/entrez/eutils`, OpenAIRE's `/graph/v1`, CORE's `/v3`.
const WITH_PATH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

let built: AxiosInstance[] = [];

const build = (baseUrl: string, options?: PooledClientOptions) => {
  const client = createPooledClient(baseUrl, options);
  built.push(client);
  return client;
};

afterEach(() => {
  // Destroys the keep-alive agents, so no handle outlives the test.
  for (const client of built) {
    client.defaults.httpAgent?.destroy();
    client.defaults.httpsAgent?.destroy();
  }
  built = [];
});

describe('client keying', () => {
  it('reuses one client per full base URL', () => {
    const client = getPooledClient(WITH_PATH);
    built.push(client);
    expect(getPooledClient(WITH_PATH)).toBe(client);
    expect(getPooledClient(`${WITH_PATH}/esearch.fcgi`)).not.toBe(client);
    built.push(getPooledClient(`${WITH_PATH}/esearch.fcgi`));
  });

  it('keeps the path on the client, which is what axios resolves against', () => {
    expect(build(WITH_PATH).defaults.baseURL).toBe(WITH_PATH);
  });
});

/**
 * No upstream answer is read past a fixed size.
 *
 * Every pooled client was created without `maxContentLength`, and axios's
 * Node default is unlimited, so one provider or authority answering with a
 * runaway body could make this process buffer all of it. The largest page measured
 * across the fan-out, on 2026-10-01, was an OpenAlex page of 200 works at
 * 9.3 MB; the cap is several times that.
 */
describe('response size', () => {
  it('caps what a pooled client will read', () => {
    const client = build('https://api.example.org', { retries: 0 });
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
      const error = await build(base, { retries: 0, timeoutMs: 20000 }).get('/big').catch(e => e);
      expect(String(error?.message)).toMatch(/maxContentLength/);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }, 20000);
});
