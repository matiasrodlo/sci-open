/**
 * Who is allowed to tell us the caller's address.
 *
 * The rate limiter keys on `request.ip`, and with no proxy configured that is
 * the socket address. Browsers never reach this service directly: the frontend
 * keeps its API paths relative, and `apps/web/app/api/[...path]/route.ts`
 * forwards them server-side. So every request the API sees arrives from the web
 * tier's single address, and the configured `RATE_LIMIT_MAX` was not a
 * per-caller budget at all — it was one bucket for the entire site, about two
 * searches a second before everyone alike started getting 429s. Measured with
 * `RATE_LIMIT_MAX=3`: three requests through, then 429 regardless of who sent
 * them.
 *
 * Fastify already knows how to resolve this. Given `trustProxy`, `request.ip`
 * becomes the left-most address in `X-Forwarded-For` that did not come from a
 * trusted hop, which is the actual caller. `@fastify/rate-limit` reads
 * `request.ip` by default, so there is nothing to configure on the limiter
 * itself.
 *
 * **It stays off unless an operator turns it on, and that is the point.**
 * `X-Forwarded-For` is a request header: trusting it from an address that is
 * not in fact a proxy hands every caller a free choice of rate-limit key, which
 * is a worse failure than the shared bucket — one throttles everybody, the
 * other throttles nobody. So there is no default that is safe everywhere, and
 * guessing one here would be guessing about a network this module cannot see.
 * Unset means unchanged behaviour.
 */

export type TrustProxySetting = boolean | string | number;

/**
 * `TRUST_PROXY` -> what Fastify should be given.
 *
 * Every form `proxy-addr` understands passes through as a string: a single
 * address, a CIDR, a comma-separated list of either, or one of the named ranges
 * `loopback`, `linklocal` and `uniquelocal`. A bare integer is a hop count —
 * "trust this many proxies in front of us" — which is the right shape when the
 * hops are known by position rather than by address.
 */
export function parseTrustProxy(value = process.env.TRUST_PROXY): TrustProxySetting {
  const raw = value?.trim();
  if (!raw) return false;

  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;

  // `Number('')` is 0 and `Number(' 2 ')` is 2, so the emptiness check above has
  // to have run first for this to mean what it says.
  if (/^\d+$/.test(raw)) return Number(raw);

  return raw;
}

/**
 * Whether the limiter is keying on the real caller.
 *
 * Read at startup so a deployment behind a proxy that forgot to set this says
 * so once, rather than presenting a site-wide throttle as a per-user one.
 */
export function trustsAnyProxy(setting: TrustProxySetting): boolean {
  return setting !== false;
}
