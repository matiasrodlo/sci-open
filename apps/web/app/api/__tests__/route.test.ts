import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, HEAD } from '../[...path]/route';

/**
 * The proxy is the whole of the frontend's contact with the API, and the part
 * of it worth testing is what it decides to pass on.
 *
 * Two of those decisions are load-bearing and neither is visible from the
 * outside. `x-forwarded-for` is deliberately *not* in the hop-by-hop list,
 * because the API's rate limit keys on `request.ip` and every browser request
 * reaches it through this handler — drop the chain here and the API sees one
 * address for every visitor. And `host` deliberately *is*, because forwarding
 * this hop's host to the next one makes the API reject or mis-route the
 * request.
 *
 * Both are one line in a `Set`, which is exactly the kind of line that gets
 * tidied by someone who does not know why it is there.
 */

const ORIGIN = 'http://api.internal:4000';

/** The upstream's answer, and what it was asked. */
let fetchMock: ReturnType<typeof vi.fn>;

const upstream = (init: { status?: number; headers?: Record<string, string>; body?: string } = {}) =>
  new Response(init.body ?? '{"ok":true}', {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
  });

/** What `fetch` was called with, as target plus init. */
const called = () => ({
  target: fetchMock.mock.calls[0]![0] as string,
  init: fetchMock.mock.calls[0]![1] as RequestInit & { headers: Headers }
});

const sentHeaders = () => called().init.headers;

const request = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
) =>
  new NextRequest(url, {
    method: init.method ?? 'GET',
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {})
  });

const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  fetchMock = vi.fn(async () => upstream());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_ORIGIN', ORIGIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('where the request goes', () => {
  it('sends it to API_ORIGIN, under /api, keeping the path', async () => {
    await GET(request('http://localhost:3000/api/paper/europepmc:42'), context('paper', 'europepmc:42'));

    expect(called().target).toBe(`${ORIGIN}/api/paper/europepmc%3A42`);
  });

  it('keeps the query string', async () => {
    await GET(request('http://localhost:3000/api/search?q=crispr&page=2'), context('search'));

    expect(called().target).toBe(`${ORIGIN}/api/search?q=crispr&page=2`);
  });

  it('reads API_ORIGIN per request rather than at build time', async () => {
    // The reason this handler exists at all: a `rewrites()` entry is resolved
    // into `.next/routes-manifest.json` at build time, which pinned the image
    // to whatever host built it.
    vi.stubEnv('API_ORIGIN', 'https://api.example.com');

    await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(called().target).toBe('https://api.example.com/api/search');
  });

  it('tolerates a trailing slash on API_ORIGIN', async () => {
    vi.stubEnv('API_ORIGIN', 'http://api.internal:4000///');

    await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(called().target).toBe(`${ORIGIN}/api/search`);
  });

  it('falls back to localhost when API_ORIGIN is unset', async () => {
    vi.stubEnv('API_ORIGIN', '');

    await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(called().target).toBe('http://localhost:4000/api/search');
  });

  it('escapes a segment that looks like a host, rather than naming one', async () => {
    // Only the path is the caller's; the origin comes from the environment.
    await GET(request('http://localhost:3000/api/x'), context('evil.com/path'));

    expect(called().target).toBe(`${ORIGIN}/api/evil.com%2Fpath`);
  });

  it('refuses a path that would walk out of /api', async () => {
    // `encodeURIComponent` leaves a dot alone — it is unreserved — so `..`
    // reaches the URL parser inside `fetch` intact and is resolved there.
    // Measured before the guard: `['..','..','health']` was requested as
    // `/health`, outside the prefix this handler is supposed to be confined to.
    const response = await GET(request('http://localhost:3000/api/x'), context('..', '..', 'health'));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([['.'], ['..']])('refuses %s as a segment anywhere in the path', async segment => {
    const response = await GET(request('http://localhost:3000/api/x'), context('paper', segment, 'x'));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not refuse a segment that merely contains dots', async () => {
    // DOIs and arXiv ids are full of them; only a segment that *is* a dot
    // segment traverses.
    await GET(request('http://localhost:3000/api/x'), context('paper', 'arxiv:2310.12345v2'));

    expect(called().target).toBe(`${ORIGIN}/api/paper/arxiv%3A2310.12345v2`);
  });
});

describe('which headers travel', () => {
  it('forwards x-forwarded-for, which the API rate limit depends on', async () => {
    // Deliberately absent from HOP_BY_HOP. Everything the browser sends reaches
    // the API through here, so without the chain the API sees this process's
    // address for every visitor and `RATE_LIMIT_MAX` becomes one bucket for the
    // whole site rather than one each.
    await GET(
      request('http://localhost:3000/api/search', {
        headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' }
      }),
      context('search')
    );

    expect(sentHeaders().get('x-forwarded-for')).toBe('203.0.113.7, 198.51.100.2');
  });

  it('drops host, which would make the API reject or mis-route the request', async () => {
    await GET(
      request('http://localhost:3000/api/search', { headers: { host: 'localhost:3000' } }),
      context('search')
    );

    expect(sentHeaders().get('host')).toBeNull();
  });

  it.each([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'accept-encoding'
  ])('drops the hop-by-hop header %s', async header => {
    await GET(
      request('http://localhost:3000/api/search', { headers: { [header]: 'x' } }),
      context('search')
    );

    expect(sentHeaders().get(header)).toBeNull();
  });

  it('forwards authorization, which is how the admin routes are reachable', async () => {
    await GET(
      request('http://localhost:3000/api/cache/metrics', {
        headers: { authorization: 'Bearer secret' }
      }),
      context('cache', 'metrics')
    );

    expect(sentHeaders().get('authorization')).toBe('Bearer secret');
  });

  it('strips hop-by-hop headers from the response as well as the request', async () => {
    // `fetch` has already decoded the body by the time it is handed on, so a
    // `content-length` or `transfer-encoding` describing the upstream's framing
    // does not describe ours.
    fetchMock.mockResolvedValue(
      upstream({ headers: { 'content-length': '9999', connection: 'keep-alive', 'x-cache-hit': 'true' } })
    );

    const response = await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('connection')).toBeNull();
    // Everything else survives: the API's own diagnostics reach the browser.
    expect(response.headers.get('x-cache-hit')).toBe('true');
  });
});

describe('methods and bodies', () => {
  it('sends a POST body on', async () => {
    await POST(
      request('http://localhost:3000/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"q":"crispr"}'
      }),
      context('search')
    );

    const body = called().init.body as ArrayBuffer;
    expect(new TextDecoder().decode(body)).toBe('{"q":"crispr"}');
    expect(called().init.method).toBe('POST');
  });

  it('sends no body on GET or HEAD, which fetch would reject', async () => {
    await GET(request('http://localhost:3000/api/search'), context('search'));
    expect(called().init.body).toBeUndefined();

    fetchMock.mockClear();
    await HEAD(request('http://localhost:3000/api/search', { method: 'HEAD' }), context('search'));
    expect(called().init.body).toBeUndefined();
  });

  it('does not follow redirects or cache, so the API decides both', async () => {
    await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(called().init.redirect).toBe('manual');
    expect(called().init.cache).toBe('no-store');
  });
});

describe('what comes back', () => {
  it('passes the upstream status through rather than flattening it', async () => {
    fetchMock.mockResolvedValue(upstream({ status: 404, body: '{"error":"Paper not found"}' }));

    const response = await GET(request('http://localhost:3000/api/paper/x'), context('paper', 'x'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Paper not found' });
  });

  it('passes a 429 through, so the rate limit reaches the browser', async () => {
    fetchMock.mockResolvedValue(upstream({ status: 429 }));

    expect((await GET(request('http://localhost:3000/api/search'), context('search'))).status).toBe(429);
  });

  it('answers 502 when the API cannot be reached', async () => {
    // A gateway failure rather than a 500: the distinction is between the API
    // being down and this app being broken, and they are fixed by different
    // people.
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const response = await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The API is unreachable',
      detail: 'fetch failed'
    });
  });
});

describe('how long the API is given to answer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes a signal, so the wait is bounded at all', async () => {
    await GET(request('http://localhost:3000/api/search'), context('search'));

    expect(called().init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers 504 when the API accepts the request and then hangs', async () => {
    // Distinct from the 502 below: the API is up, it is simply not answering.
    // Node's `fetch` would have waited 300 seconds for this on its own.
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_target: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );

    const pending = GET(request('http://localhost:3000/api/search'), context('search'));
    await vi.advanceTimersByTimeAsync(30000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'The API did not answer',
      detail: 'no response within 30000ms'
    });
  });

  it('does not time out an answer that arrives inside the budget', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_target: string, _init: RequestInit) =>
        new Promise(resolve => setTimeout(() => resolve(upstream()), 29000))
    );

    const pending = GET(request('http://localhost:3000/api/search'), context('search'));
    await vi.advanceTimersByTimeAsync(29000);

    expect((await pending).status).toBe(200);
  });

  it('stops the clock once the headers arrive, so a long download is not cut off', async () => {
    // The budget is on the wait for an answer, not on the transfer. The PDF
    // proxy streams up to fifty megabytes through here, and a slow minute of
    // that is an ordinary download rather than a hung upstream —
    // `AbortSignal.timeout` would have aborted it mid-body.
    vi.useFakeTimers();

    await GET(request('http://localhost:3000/api/paper/x'), context('paper', 'x'));
    await vi.advanceTimersByTimeAsync(600000);

    expect(called().init.signal!.aborted).toBe(false);
  });
});
