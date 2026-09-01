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

export type TrustProxySetting = boolean | string;

/** A bare integer, which used to mean "trust this many hops". See below. */
const HOP_COUNT = /^\d+$/;

/**
 * `TRUST_PROXY` -> what Fastify should be given.
 *
 * Every form `proxy-addr` understands passes through as a string: a single
 * address, a CIDR, a comma-separated list of either, or one of the named ranges
 * `loopback`, `linklocal` and `uniquelocal`.
 *
 * **A hop count is refused rather than passed on.** Fastify 4 accepted a number
 * here — "trust this many proxies in front of us" — and Fastify 5 does not.
 * It does not reject one either: `getTrustProxyFn` in `lib/request.js` answers a
 * number with a function that returns `false` for every address, on the grounds
 * that hop-count-only trust cannot validate the immediate peer, so a direct
 * client could spoof `X-Forwarded-*` by supplying enough hops. Failing closed is
 * the right call upstream.
 *
 * What it means here is that a deployment carrying `TRUST_PROXY=1` would keep
 * booting, keep looking configured, and quietly go back to keying the rate limit
 * on the connecting address — one bucket for every visitor, which is the whole
 * defect this variable exists to fix. So a hop count resolves to `false` and
 * `trustProxyWarning` says so at startup, rather than being handed to Fastify to
 * be ignored in silence.
 */
export function parseTrustProxy(value = process.env.TRUST_PROXY): TrustProxySetting {
  const raw = value?.trim();
  if (!raw) return false;

  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;

  // `Number('')` is 0, so the emptiness check above has to have run first for
  // this to mean what it says.
  if (HOP_COUNT.test(raw)) return false;

  return raw;
}

/**
 * Why a configured `TRUST_PROXY` is not in effect, when it is not.
 *
 * Separate from `parseTrustProxy` so both stay pure and the caller reads the
 * environment once. Returns nothing when the value is usable, including when it
 * is legitimately unset — the caller has its own line for that case.
 */
export function trustProxyWarning(value = process.env.TRUST_PROXY): string | undefined {
  const raw = value?.trim();
  if (!raw || !HOP_COUNT.test(raw)) return undefined;

  return (
    `TRUST_PROXY is set to "${raw}", a hop count, which Fastify 5 cannot honour — ` +
    'it trusts no proxy at all rather than that many. The rate limit is therefore ' +
    'keyed on the connecting address, which behind the web tier is one shared ' +
    'bucket for every visitor. Name the proxy by address or CIDR instead.'
  );
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
