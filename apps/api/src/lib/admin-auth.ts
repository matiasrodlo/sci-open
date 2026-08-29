import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The cache, performance, smart-source and debug routes are operational
 * controls, not part of the public product surface. They clear caches, rewrite
 * source-selection config, and drive an arbitrary-URL load tester, so they are
 * gated behind a shared key supplied as `Authorization: Bearer <ADMIN_API_KEY>`.
 *
 * `apps/web/next.config.js` proxies `/api/*` straight through to this service,
 * so anything left open here is reachable from any browser that can load the
 * site. The gate therefore fails closed: with no key configured the routes are
 * disabled outright rather than served unauthenticated. This deliberately does
 * not key off NODE_ENV, which is unset often enough that treating it as a
 * safety boundary is how these endpoints end up public.
 */

export function getAdminKey(): string | undefined {
  const key = process.env.ADMIN_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

function extractPresentedKey(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  const alt = request.headers['x-admin-key'];
  if (typeof alt === 'string' && alt.length > 0) return alt;

  return undefined;
}

/**
 * Compares digests rather than the raw values: timingSafeEqual throws on a
 * length mismatch, which would otherwise leak the key length.
 */
function matchesAdminKey(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const expected = getAdminKey();

  if (!expected) {
    request.log.warn(
      { url: request.url },
      'Blocked an administrative request: ADMIN_API_KEY is not configured'
    );
    reply.code(503).send({
      error: 'Administrative endpoints are disabled. Set ADMIN_API_KEY to enable them.'
    });
    return reply;
  }

  const presented = extractPresentedKey(request);

  if (!presented || !matchesAdminKey(presented, expected)) {
    request.log.warn(
      { url: request.url, ip: request.ip },
      'Rejected an administrative request with a missing or invalid key'
    );
    reply.code(401).send({ error: 'Unauthorized' });
    return reply;
  }
}

/** Route options shorthand, so each protected route reads as one line. */
export const adminOnly = { preHandler: requireAdmin };
