import axios from 'axios';
import dns from 'dns';
import net from 'net';
import { PassThrough, Readable } from 'stream';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

// Publishers occasionally serve very large scans; anything past this is
// almost certainly not a paper we should be proxying.
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

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
 * Cheap synchronous check, used for redirect hops where we cannot await DNS.
 */
export function assertRoutableHostSync(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw new PdfProxyError('Refusing to download from a non-public host', 403);
  }
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new PdfProxyError('Refusing to download from a non-public address', 403);
  }
}

/**
 * Validates scheme and resolves the hostname, rejecting anything that lands on
 * a loopback, private, or link-local address.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
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
      throw new PdfProxyError('Refusing to download from a non-public address', 403);
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
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/pdf,*/*'
    },
    // Each redirect hop is a fresh chance to be pointed somewhere internal.
    beforeRedirect: (options: Record<string, any>) => {
      if (options.protocol !== 'http:' && options.protocol !== 'https:') {
        throw new PdfProxyError('Refusing to follow a non-http redirect', 403);
      }
      assertRoutableHostSync(String(options.hostname || options.host || ''));
    },
    validateStatus: (status: number) => status >= 200 && status < 400
  }).catch((error: any) => {
    if (error instanceof PdfProxyError) {
      throw error;
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
