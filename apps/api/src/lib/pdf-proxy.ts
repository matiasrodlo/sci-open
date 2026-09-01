import axios from 'axios';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { PassThrough, Readable } from 'stream';
import { promisify } from 'util';
import { preferredPdfUrl } from './pdf-url';

const dnsLookup = promisify(dns.lookup);

// Publishers occasionally serve very large scans; anything past this is
// almost certainly not a paper we should be proxying.
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Publisher PDFs are routinely four or five hops away — a DOI resolver, a
 * platform redirect, a session cookie bounce, then the file — and five was
 * enough to run out partway and report a failure that a longer chain would
 * have completed. Every hop is still checked against the same SSRF rules, so
 * the ceiling costs nothing but time.
 */
const MAX_REDIRECTS = 10;

export class PdfProxyError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'PdfProxyError';
  }
}

export type PdfStream = {
  stream: Readable;
  contentLength?: number;
  filename: string;
};

/**
 * The pdfUrl arrives from the browser, so this endpoint would otherwise be an
 * open proxy into whatever the API server can reach. Everything below exists to
 * keep it pointed at the public internet only.
 */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;          // this-host, private, loopback
  if (a === 169 && b === 254) return true;                     // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;            // private
  if (a === 192 && b === 168) return true;                     // private
  if (a === 100 && b >= 64 && b <= 127) return true;           // carrier NAT
  if (a === 192 && b === 0) return true;                       // protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true;        // benchmarking
  if (a >= 224) return true;                                   // multicast and reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;

  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isBlockedIpv4(mapped[1]);
  }

  const head = parseInt(lower.split(':')[0] || '0', 16);
  if ((head & 0xfe00) === 0xfc00) return true;                 // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true;                 // fe80::/10 link-local
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  return /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(hostname);
}

/**
 * Marks a refusal raised from inside the socket guard, so it can be recognised
 * again after axios and follow-redirects have each wrapped it.
 */
export const SSRF_REFUSED = 'ESSRFREFUSED';

function refusal(message: string): PdfProxyError {
  return Object.assign(new PdfProxyError(message, 403), { code: SSRF_REFUSED });
}

/**
 * The address check, moved onto the socket.
 *
 * Validating the URL was never enough, and the gap was not subtle. The
 * pre-flight check below resolves the hostname the caller sent; every
 * **redirect** hop got `assertRoutableHostSync` instead, which — as its own
 * name says — cannot await DNS, so it could only inspect hostname suffixes and
 * literal IPs. A name that resolved inward was invisible to it. An attacker
 * posted a URL on a host they controlled, that host answered 302 pointing at any
 * name resolving to an internal address, and the proxy fetched it and streamed
 * the body back. Reproduced against a local server through a `.nip.io`-style
 * name: the response body came back to the caller intact.
 *
 * The same hole, in slower motion, existed without any redirect at all. The
 * pre-flight resolved the name and then axios resolved it *again* to connect —
 * two lookups, so a low-TTL record could answer public for the first and
 * private for the second.
 *
 * Both close here, because this runs at the point of connection and nothing
 * gets to re-resolve afterwards: `net` connects to the very address this
 * returns. Every hop uses the same agents, so hop five is checked exactly as
 * hop one is.
 *
 * The whole answer is rejected when any address in it is blocked, matching the
 * pre-flight check rather than quietly connecting to whichever address happened
 * to be public. A publisher does not answer with a private address; something
 * aiming this at the private network does.
 */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | number,
  callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
): void {
  const requested = typeof options === 'number' ? { family: options } : (options ?? {});

  // Always asked for in full, whatever the caller wanted, so every address the
  // name carries is checked and not just the one that would have been used.
  dns.lookup(hostname, { ...requested, all: true }, (error, addresses) => {
    if (error) return callback(error);

    const resolved = (addresses ?? []) as Array<{ address: string; family: number }>;
    if (resolved.length === 0) {
      return callback(refusal('Could not resolve the PDF host'));
    }

    if (resolved.some(record => isBlockedIp(record.address))) {
      return callback(refusal('Refusing to download from a non-public address'));
    }

    // `all` is what Node asked for, not what we asked DNS for. Node 22+ sets it
    // for happy-eyeballs; older paths and TLS may not.
    if ((requested as dns.LookupAllOptions).all) return callback(null, resolved);

    const [first] = resolved;
    callback(null, first.address, first.family);
  });
}

/** Agents that cannot be pointed inward, whatever the redirect chain says. */
const guardedHttpAgent = new http.Agent({ keepAlive: true, lookup: guardedLookup });
const guardedHttpsAgent = new https.Agent({ keepAlive: true, lookup: guardedLookup });

/**
 * Recognises a refusal from `guardedLookup` after it has been wrapped.
 *
 * A socket error travels through follow-redirects, which restates it as
 * "Redirected request failed: ...", and then axios, which rebuilds it as an
 * AxiosError. Neither keeps the instance, so the chain is walked for the marker
 * rather than the class. Without this an SSRF refusal reaches the caller as a
 * generic 502, which reads like the upstream being down.
 */
export function ssrfRefusalIn(error: unknown): PdfProxyError | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; message?: string; cause?: unknown };
    if (candidate.code === SSRF_REFUSED) {
      return new PdfProxyError(candidate.message ?? 'Refusing to download from a non-public address', 403);
    }
    current = candidate.cause;
  }
  return undefined;
}

/**
 * Cheap synchronous check, used for redirect hops before a socket is attempted.
 *
 * Kept as the first of two gates rather than the only one. It rejects a literal
 * private address in a redirect without the cost of a lookup; `guardedLookup`
 * is what catches the hostname that resolves to one.
 */
export function assertRoutableHostSync(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw refusal('Refusing to download from a non-public host');
  }
  if (net.isIP(host) && isBlockedIp(host)) {
    throw refusal('Refusing to download from a non-public address');
  }
}

/**
 * Validates scheme and resolves the hostname, rejecting anything that lands on
 * a loopback, private, or link-local address.
 *
 * A pre-flight, not the guarantee. It answers a plainly bad URL with a clean
 * 400 or 403 before any connection is opened, and it is the only place the
 * scheme is checked. What it cannot do is speak for the address finally
 * connected to — it resolves the name, and the connection resolves it again —
 * so `guardedLookup` on the agents is what the safety actually rests on.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    // Substituted before validation, never after, so a rewritten host is
    // resolved and checked exactly as the one the caller sent would have been.
    url = new URL(preferredPdfUrl(rawUrl));
  } catch {
    throw new PdfProxyError('pdfUrl is not a valid URL', 400);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PdfProxyError('Only http and https URLs can be downloaded', 400);
  }

  assertRoutableHostSync(url.hostname);

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    let addresses: { address: string }[];
    try {
      addresses = (await dnsLookup(host, { all: true })) as { address: string }[];
    } catch {
      throw new PdfProxyError('Could not resolve the PDF host', 400);
    }

    if (!addresses.length || addresses.some(record => isBlockedIp(record.address))) {
      throw refusal('Refusing to download from a non-public address');
    }
  }

  return url;
}

function filenameFor(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() || 'paper';
  const base = decodeURIComponent(last).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function looksLikePdfResponse(url: URL, contentType: string): boolean {
  if (contentType.startsWith('application/pdf') || contentType.startsWith('application/octet-stream')) {
    return true;
  }
  // Some repositories serve PDFs with a generic or missing content type.
  const href = url.href.toLowerCase();
  return !contentType || href.includes('.pdf') || href.includes('pdf=render') || href.includes('type=printable');
}

/**
 * Streams the PDF rather than buffering it, so a large file does not sit in
 * memory on its way to the browser.
 */
export async function fetchPdfStream(url: URL, userAgent: string): Promise<PdfStream> {
  const response = await axios.get<Readable>(url.href, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    // The guard that actually holds. Both are set because follow-redirects
    // picks the agent per hop by scheme, so a chain that crosses from https to
    // http must not land on an unguarded default.
    httpAgent: guardedHttpAgent,
    httpsAgent: guardedHttpsAgent,
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/pdf,*/*'
    },
    // Each redirect hop is a fresh chance to be pointed somewhere internal.
    // This rejects the obvious form of that — a private literal, a non-http
    // scheme — before a connection is attempted; `guardedLookup` on the agents
    // above is what stops a hostname that resolves inward.
    beforeRedirect: (options: Record<string, any>) => {
      if (options.protocol !== 'http:' && options.protocol !== 'https:') {
        throw refusal('Refusing to follow a non-http redirect');
      }
      assertRoutableHostSync(String(options.hostname || options.host || ''));
    },
    validateStatus: (status: number) => status >= 200 && status < 400
  }).catch((error: any) => {
    if (error instanceof PdfProxyError) {
      throw error;
    }
    // Before the generic mapping below, because a refusal reaching the caller
    // as "502, could not reach the PDF" reads like an upstream outage rather
    // than a request we declined to make.
    const refused = ssrfRefusalIn(error);
    if (refused) {
      throw refused;
    }
    const status = error.response?.status;
    throw new PdfProxyError(
      status ? `Upstream returned ${status} for the PDF` : `Could not reach the PDF: ${error.message}`,
      status && status >= 400 && status < 500 ? 404 : 502
    );
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (!looksLikePdfResponse(url, contentType)) {
    response.data.destroy();
    throw new PdfProxyError(`Upstream served ${contentType || 'an unknown type'}, not a PDF`, 415);
  }

  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    response.data.destroy();
    throw new PdfProxyError('PDF is larger than the download limit', 413);
  }

  // Enforce the cap on the wire too, since content-length is often absent.
  const limited = new PassThrough();
  let received = 0;
  response.data.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_PDF_BYTES) {
      response.data.destroy();
      limited.destroy(new PdfProxyError('PDF is larger than the download limit', 413));
    }
  });
  response.data.on('error', (error: Error) => limited.destroy(error));
  response.data.pipe(limited);

  return {
    stream: limited,
    contentLength: Number.isFinite(declaredLength) ? declaredLength : undefined,
    filename: filenameFor(url)
  };
}
