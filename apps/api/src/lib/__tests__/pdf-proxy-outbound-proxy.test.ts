import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// Every name resolves to loopback here, which the guard refuses — so a
// download that reaches the guard is refused, and one that does not comes back.
// The resolver is replaced at module level, as `pdf-proxy.test.ts` explains.
vi.mock('dns', () => ({
  default: {
    lookup: (_host: string, _opts: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      cb(null, [{ address: '127.0.0.1', family: 4 }])
  }
}));

import { fetchPdfStream, PdfProxyError } from '../pdf-proxy';

/**
 * An outbound proxy named in the environment, which axios uses unless told not
 * to.
 *
 * Through one, the socket the guard judges is the proxy's: measured against a
 * stub proxy on 127.0.0.1, the publisher was never looked up — the proxy
 * fetched it — and every redirect was refused for the proxy's own address, a
 * public site's as well. So the download must ignore the variable and connect
 * directly, where the guard can see what it connects to.
 */
describe('an outbound proxy in the environment', () => {
  const asked: string[] = [];
  const saved = { http: process.env.HTTP_PROXY, https: process.env.HTTPS_PROXY, no: process.env.NO_PROXY };

  // Answers anything with a PDF, as a hostile or mistaken proxy would.
  const proxy = http.createServer((request, response) => {
    asked.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/pdf' });
    response.end('%PDF-1.4 fetched by the proxy, past the guard');
  });

  beforeAll(async () => {
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const { port } = proxy.address() as AddressInfo;
    process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
    delete process.env.NO_PROXY;
  });

  afterAll(async () => {
    for (const [key, value] of [['HTTP_PROXY', saved.http], ['HTTPS_PROXY', saved.https], ['NO_PROXY', saved.no]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  });

  it('is not used: the download connects directly, so the guard judges the publisher', async () => {
    const outcome = await fetchPdfStream(new URL('http://publisher.test/paper.pdf'), 'test').then(
      () => 'downloaded through the proxy',
      (error: unknown) => error
    );

    // Refused at the socket, for the address the name resolves to …
    expect(outcome).toBeInstanceOf(PdfProxyError);
    expect((outcome as PdfProxyError).statusCode).toBe(403);
    // … and the proxy never asked.
    expect(asked).toEqual([]);
  });
});
