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

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${apiOrigin()}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardable(request.headers),
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      // A PDF can be tens of megabytes; the body is handed on as a stream
      // rather than buffered here.
      redirect: 'manual',
      cache: 'no-store'
    });
  } catch (error) {
    // The API being unreachable is a gateway failure, and saying so is more
    // use than a 500 that looks like an application bug.
    return Response.json(
      { error: 'The API is unreachable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
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
