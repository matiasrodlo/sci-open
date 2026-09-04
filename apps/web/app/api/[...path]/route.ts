import { NextRequest } from 'next/server';

/**
 * Forwards `/api/*` to the API service, resolving where it lives at request
 * time.
 *
 * This replaces the `rewrites()` entry in `next.config.js`, which could not do
 * the job. Next resolves rewrites at build time and writes them into
 * `.next/routes-manifest.json` — verified, the built manifest contained
 * `"destination": "http://localhost:4000/api/:path*"` — so the destination is
 * baked into the image and no environment variable can move it afterwards.
 * That is what pinned the web image permanently to localhost, and a build
 * `ARG` would only have chosen the pin, not removed it: the same image still
 * could not be promoted from staging to production.
 *
 * A route handler is read on every request, so `API_ORIGIN` is a deployment
 * concern again. The browser keeps talking to its own origin, which is what
 * phase 11 moved it onto.
 *
 * Not a general proxy: the origin comes from the environment and only the path
 * comes from the caller, so there is no URL a request can name.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function apiOrigin(): string {
  return (process.env.API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');
}

/**
 * Headers that describe *this* hop rather than the message, and must not be
 * copied onto the next one. `host` in particular would make the API reject or
 * mis-route the request.
 */
/**
 * `x-forwarded-for` is deliberately absent from this list, and it is the one
 * header whose passing-through matters.
 *
 * Everything the browser sends reaches the API through this handler, so the API
 * sees one address — this process — for every visitor unless the chain reaches
 * it. Its rate limit keys on that, and only believes the header from hops named
 * in its own `TRUST_PROXY`; forwarding the chain intact is this side's half of
 * the arrangement.
 *
 * Nothing can be *added* to the chain here. A route handler cannot see its own
 * socket, so the address this process received the request from is not knowable
 * from inside it. `NextRequest.ip` used to stand in and was removed in Next 15;
 * it was only ever populated on Vercel, so self-hosted it was already
 * undefined. The chain therefore has to be started by a real proxy or load
 * balancer in front of this app — which is also the only arrangement in which
 * the API could safely believe it.
 */
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-length', 'accept-encoding'
]);

function forwardable(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

/**
 * A segment that would walk out of `/api/`.
 *
 * `encodeURIComponent` does not escape a dot — it is unreserved — so `..`
 * survives it unchanged, and the URL parser inside `fetch` then resolves the
 * traversal before the request goes out. Measured: a path of `['..', '..',
 * 'health']` builds `…:4000/api/../../health` and is requested as `/health`.
 *
 * That does not reach another host — the origin still comes from the
 * environment, and only the path is the caller's — but it does reach any path
 * on the API service, which is more than the comment above claims and more than
 * this handler should offer. Today that is only `/health` and Fastify's 404,
 * so the value of closing it is that the next thing mounted outside `/api` is
 * not quietly exposed by a proxy nobody re-reads.
 *
 * Refused rather than stripped: a request naming a path that does not exist is
 * a request to answer, not one to silently rewrite into a different one.
 */
function walksOut(segment: string): boolean {
  return segment === '.' || segment === '..';
}

/**
 * How long the API may take to *answer*, not to finish sending.
 *
 * Every other hop in this system owns a budget — twenty seconds per provider,
 * two and a half per authority lookup, five for the whole rescue — and this one
 * did not. Node's `fetch` defaults to a 300-second headers timeout, so an API
 * that accepted the connection and then hung held a request here for five
 * minutes, and the reader saw a spinner for all of it.
 *
 * Thirty seconds is above anything the two routes that reach the API through
 * here can legitimately take. `/api/paper/:id` is a 15s lookup plus a 6s
 * enrichment budget; `/api/download-pdf` answers as soon as the publisher's
 * headers arrive. A slower answer than this is a hung upstream, not a slow one.
 */
const UPSTREAM_TIMEOUT_MS = 30000;

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  if (path.some(walksOut)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const target = `${apiOrigin()}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  /**
   * The budget covers the wait for headers and stops there.
   *
   * `AbortSignal.timeout` would have been shorter and wrong: it keeps counting
   * after the response resolves, so it aborts the *body* mid-stream — and the
   * one route through here that streams is the PDF proxy, where fifty megabytes
   * over a slow link is a normal minute rather than a stuck upstream. `fetch`
   * resolves once the headers arrive, so clearing the timer there bounds the
   * part that can hang without putting a clock on the part that is merely long.
   */
  const controller = new AbortController();
  const expiry = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardable(request.headers),
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      // A PDF can be tens of megabytes; the body is handed on as a stream
      // rather than buffered here.
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    // A timeout and a refused connection are both gateway failures, but they
    // are different ones: 504 says the API is up and not answering, 502 says it
    // could not be reached at all.
    if (controller.signal.aborted) {
      return Response.json(
        { error: 'The API did not answer', detail: `no response within ${UPSTREAM_TIMEOUT_MS}ms` },
        { status: 504 }
      );
    }

    // The API being unreachable is a gateway failure, and saying so is more
    // use than a 500 that looks like an application bug.
    return Response.json(
      { error: 'The API is unreachable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  } finally {
    clearTimeout(expiry);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardable(upstream.headers)
  });
}

/**
 * `params` is a promise since Next 15. Awaiting it is the whole of the change:
 * the value inside is the same shape it always was.
 */
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Context) {
  return proxy(request, (await params).path);
}

export async function POST(request: NextRequest, { params }: Context) {
  return proxy(request, (await params).path);
}

export async function HEAD(request: NextRequest, { params }: Context) {
  return proxy(request, (await params).path);
}
