import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { PassThrough, Readable } from 'stream';
import { gzipSync } from 'zlib';

// pdf-fetch binds `promisify(dns.lookup)` at import time, so the resolver has
// to be replaced at module level rather than spied on afterwards. The same stub
// serves `guardedLookup`, which resolves through `dns.lookup` directly.
const resolver = vi.hoisted(() => ({
  addresses: [] as { address: string }[],
  error: null as Error | null
}));

vi.mock('dns', () => ({
  default: {
    lookup: (_host: string, _opts: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      resolver.error ? cb(resolver.error) : cb(null, resolver.addresses)
  }
}));

import {
  assertRoutableHostSync,
  assertPublicHttpUrl,
  guardedLookup,
  ssrfRefusalIn,
  fetchPdfStream,
  servesPdf,
  PdfFetchError,
  SSRF_REFUSED
} from '../pdf-fetch';

/**
 * A PDF's URL comes from a source's record, so without these checks a fetch
 * could reach whatever this process can — including cloud instance metadata at
 * 169.254.169.254 and anything on the private network. This is the
 * highest-value suite in the repo: every case below is a request an attacker
 * would actually send.
 */

const blocked = (host: string) => () => assertRoutableHostSync(host);

describe('assertRoutableHostSync — IPv4', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback, whole /8'],
    ['0.0.0.0', 'this-host'],
    ['10.0.0.1', 'private /8'],
    ['172.16.0.1', 'private, low end of /12'],
    ['172.31.255.254', 'private, high end of /12'],
    ['192.168.1.1', 'private /16'],
    ['169.254.169.254', 'link-local — cloud instance metadata'],
    ['100.64.0.1', 'carrier NAT, low end'],
    ['100.127.255.254', 'carrier NAT, high end'],
    ['192.0.0.1', 'protocol assignments'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast']
  ])('blocks %s (%s)', ip => {
    expect(blocked(ip)).toThrow(PdfFetchError);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.0.1'],   // just below the private /12
    ['172.32.0.1'],   // just above the private /12
    ['100.63.255.255'], // just below carrier NAT
    ['100.128.0.1']   // just above carrier NAT
  ])('allows public address %s', ip => {
    expect(blocked(ip)).not.toThrow();
  });
});

describe('assertRoutableHostSync — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local, low end of /7'],
    ['fdff::1', 'unique local, high end of /7'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local, high end of /10'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    // The spelling the URL parser actually produces for the two above.
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address, hex'],
    ['0:0:0:0:0:ffff:7f00:1', 'IPv4-mapped loopback, uncompressed'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['::7f00:1', 'IPv4-compatible loopback, hex'],
    ['::ffff:0:7f00:1', 'IPv4-translated loopback'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 metadata address'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['100::1', 'discard'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::1', '6to4']
  ])('blocks %s (%s)', ip => {
    expect(blocked(ip)).toThrow(PdfFetchError);
  });

  it('allows a public IPv6 address', () => {
    expect(blocked('2606:4700:4700::1111')).not.toThrow();
  });

  it.each([
    ['::ffff:8.8.8.8', 'IPv4-mapped'],
    ['::ffff:808:808', 'IPv4-mapped, hex'],
    ['64:ff9b::808:808', 'NAT64, as DNS64 hands it out']
  ])('allows a public IPv4 address embedded as %s (%s)', ip => {
    expect(blocked(ip)).not.toThrow();
  });

  it('unwraps bracketed IPv6 literals before checking them', () => {
    expect(blocked('[::1]')).toThrow(PdfFetchError);
  });
});

describe('assertRoutableHostSync — hostnames', () => {
  it.each(['localhost', 'foo.localhost', 'db.internal', 'printer.local', 'host.localdomain', 'router.home.arpa'])(
    'blocks %s',
    host => expect(blocked(host)).toThrow(PdfFetchError)
  );

  it.each(['example.com', 'arxiv.org', 'localhost.example.com'])('allows %s', host =>
    expect(blocked(host)).not.toThrow()
  );
});

describe('assertPublicHttpUrl', () => {
  beforeEach(() => {
    resolver.addresses = [{ address: '93.184.216.34' }];
    resolver.error = null;
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com'])(
    'rejects the %s scheme',
    async url => {
      await expect(assertPublicHttpUrl(url)).rejects.toThrow(PdfFetchError);
    }
  );

  it('rejects a malformed URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(PdfFetchError);
  });

  it('rejects a loopback URL without needing DNS', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/secret')).rejects.toThrow(PdfFetchError);
  });

  it('rejects the cloud metadata endpoint', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      PdfFetchError
    );
  });

  /**
   * Through the URL parser, which is where the hole was. `new URL` rewrites
   * `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, and a literal never reaches
   * DNS — so a check that knew only the dotted spelling let every one of these
   * through, and the fetch read back what a loopback-only server said.
   */
  it.each([
    'http://[::ffff:127.0.0.1]:4000/x?x=.pdf',
    'http://[::ffff:169.254.169.254]/latest/meta-data/?x=.pdf',
    'http://[::ffff:7f00:1]/x.pdf',
    'http://[::127.0.0.1]/x.pdf',
    'http://[64:ff9b::7f00:1]/x.pdf',
    'http://[0:0:0:0:0:ffff:a00:1]/x.pdf'
  ])('rejects the IPv6 literal %s', async url => {
    await expect(assertPublicHttpUrl(url)).rejects.toMatchObject({ code: SSRF_REFUSED });
  });

  it('accepts a public IP literal without touching DNS', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/paper.pdf');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('accepts a hostname resolving only to public addresses', async () => {
    const url = await assertPublicHttpUrl('https://example.com/paper.pdf');
    expect(url.href).toBe('https://example.com/paper.pdf');
  });

  it('rejects a hostname that resolves to a private address', async () => {
    // DNS rebinding: the name is public, the address it resolves to is not
    resolver.addresses = [{ address: '10.0.0.5' }];
    await expect(assertPublicHttpUrl('https://evil.example.com/x.pdf')).rejects.toThrow(PdfFetchError);
  });

  it('rejects when any resolved address is private, not just the first', async () => {
    resolver.addresses = [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    await expect(assertPublicHttpUrl('https://split.example.com/x.pdf')).rejects.toThrow(PdfFetchError);
  });

  it('rejects a host that resolves to nothing at all', async () => {
    resolver.addresses = [];
    await expect(assertPublicHttpUrl('https://empty.example.com/x.pdf')).rejects.toThrow(PdfFetchError);
  });

  it('rejects a host whose lookup fails', async () => {
    resolver.error = new Error('ENOTFOUND');
    await expect(assertPublicHttpUrl('https://missing.example.com/x.pdf')).rejects.toThrow(PdfFetchError);
  });
});

/**
 * The socket-level guard, which is what the safety actually rests on.
 *
 * Checking the URL was never enough. The pre-flight above resolves the name the
 * caller sent; a **redirect** hop only ever got `assertRoutableHostSync`, which
 * cannot await DNS and so could not see a hostname that resolves inward. An
 * attacker posted a URL on a host they controlled, that host answered 302 at
 * any name resolving to an internal address, and the body came back to them.
 * Reproduced end to end before this existed.
 *
 * Driven through the stubbed resolver rather than a live socket, which is what
 * keeps this suite offline — the same arrangement `assertPublicHttpUrl` is
 * tested under.
 */
describe('guardedLookup', () => {
  const lookup = (options: unknown = { all: true }) =>
    new Promise<{ err: any; value: any }>(resolve => {
      guardedLookup('publisher.example.com', options as any, (err, value) =>
        resolve({ err, value })
      );
    });

  beforeEach(() => {
    resolver.addresses = [{ address: '93.184.216.34' }];
    resolver.error = null;
  });

  it('refuses a name that resolves to a private address', async () => {
    resolver.addresses = [{ address: '10.0.0.5' }];
    const { err } = await lookup();

    expect(err).toBeInstanceOf(PdfFetchError);
    expect(err.code).toBe(SSRF_REFUSED);
  });

  it('refuses the cloud metadata address', async () => {
    resolver.addresses = [{ address: '169.254.169.254' }];
    expect((await lookup()).err).toBeInstanceOf(PdfFetchError);
  });

  it('refuses when any address in the answer is private, not just the first', async () => {
    // Connecting to whichever address happened to be public would be the whole
    // hole again, one DNS answer later.
    resolver.addresses = [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    expect((await lookup()).err).toBeInstanceOf(PdfFetchError);
  });

  it('refuses an answer that spells a private address as IPv4-mapped hex', async () => {
    resolver.addresses = [{ address: '::ffff:a00:5' }];
    expect((await lookup()).err).toBeInstanceOf(PdfFetchError);
  });

  it('refuses a name that resolves to nothing', async () => {
    resolver.addresses = [];
    expect((await lookup()).err).toBeInstanceOf(PdfFetchError);
  });

  it('passes a public answer through', async () => {
    const { err, value } = await lookup();

    expect(err).toBeNull();
    expect(value).toEqual([{ address: '93.184.216.34' }]);
  });

  it('answers with one address when Node did not ask for all', async () => {
    // Node sets `all` for happy-eyeballs, but TLS and older paths may not, and
    // handing an array back where a string is expected fails the connection.
    const { err, value } = await lookup({ family: 4 });

    expect(err).toBeNull();
    expect(value).toBe('93.184.216.34');
  });

  it('propagates a resolver failure rather than dressing it as a refusal', async () => {
    resolver.error = new Error('ENOTFOUND');
    expect((await lookup()).err.message).toBe('ENOTFOUND');
  });

  it('marks every refusal so it survives being wrapped', async () => {
    resolver.addresses = [{ address: '192.168.1.1' }];
    expect((await lookup()).err.code).toBe(SSRF_REFUSED);
  });
});

describe('ssrfRefusalIn', () => {
  // A refusal raised inside the socket guard reaches the caller through
  // follow-redirects, which restates it, and then axios, which rebuilds it as
  // an AxiosError. Neither keeps the instance. Without this the caller is told
  // "could not reach the PDF", which reads like an upstream outage rather than
  // a request we declined to make.
  it('finds a refusal wrapped two layers deep', () => {
    const wrapped = Object.assign(new Error('Request failed'), {
      cause: Object.assign(new Error('Redirected request failed: refused'), {
        cause: Object.assign(new Error('Refusing to download from a non-public address'), {
          code: SSRF_REFUSED
        })
      })
    });

    const found = ssrfRefusalIn(wrapped);
    expect(found).toBeInstanceOf(PdfFetchError);
    expect(found).toMatchObject({ code: SSRF_REFUSED });
    expect(found!.message).toBe('Refusing to download from a non-public address');
  });

  it('finds one that was not wrapped at all', () => {
    const bare = Object.assign(new Error('Refusing to download from a non-public address'), {
      code: SSRF_REFUSED
    });
    expect(ssrfRefusalIn(bare)).toBeInstanceOf(PdfFetchError);
  });

  it('leaves an ordinary transport failure alone', () => {
    // A real upstream outage has to stay one, or every failure reads as a
    // refusal.
    expect(ssrfRefusalIn(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })))
      .toBeUndefined();
  });

  it('terminates on a cause cycle', () => {
    const a: any = new Error('a');
    const b: any = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(ssrfRefusalIn(a)).toBeUndefined();
  });
});

describe('fetchPdfStream — upstream failures', () => {
  afterEach(() => vi.restoreAllMocks());

  const fetchAfter = async (error: unknown) => {
    vi.spyOn(axios, 'get').mockRejectedValue(error);
    return fetchPdfStream(new URL('https://publisher.example.com/paper.pdf'), 'ua')
      .catch((e: PdfFetchError) => e);
  };

  // A 403 is bot protection — the file is there and we are refused — and a 404
  // is a stale record; the message names which, for whoever reads the log.
  it.each([403, 404])('names the publisher\'s %i', async status => {
    const error = await fetchAfter({ response: { status }, message: 'Request failed' });

    expect(error).toBeInstanceOf(PdfFetchError);
    expect((error as PdfFetchError).message).toBe(`Upstream returned ${status} for the PDF`);
  });

  it('reports a transport failure as one', async () => {
    const error = await fetchAfter(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    expect(error).toBeInstanceOf(PdfFetchError);
    expect((error as PdfFetchError).message).toBe('Could not reach the PDF: socket hang up');
  });
});

describe('fetchPdfStream wiring', () => {
  // `guardedLookup` being correct buys nothing if the request does not use it.
  // Dropping these two lines from the axios config reopens the hole exactly,
  // and every other test in this file would still pass — so the attachment is
  // asserted rather than assumed.
  afterEach(() => vi.restoreAllMocks());

  const configOf = async () => {
    const get = vi.spyOn(axios, 'get').mockRejectedValue(new Error('stop here'));
    await fetchPdfStream(new URL('https://publisher.example.com/paper.pdf'), 'ua').catch(() => {});
    return get.mock.calls[0][1] as any;
  };

  it('fetches through agents that resolve with the guard', async () => {
    const config = await configOf();

    expect(config.httpAgent.options.lookup).toBe(guardedLookup);
    expect(config.httpsAgent.options.lookup).toBe(guardedLookup);
  });

  it('guards both schemes, so a chain crossing https to http stays checked', async () => {
    // follow-redirects picks the agent per hop by scheme. One guarded agent and
    // one default would leave every hop on the other scheme unprotected.
    const config = await configOf();

    expect(config.httpAgent).toBeDefined();
    expect(config.httpsAgent).toBeDefined();
    expect(config.httpAgent).not.toBe(config.httpsAgent);
  });

  it('still refuses a redirect to a private literal before connecting', async () => {
    const config = await configOf();

    expect(() => config.beforeRedirect({ protocol: 'http:', hostname: '169.254.169.254' }))
      .toThrow(PdfFetchError);
    expect(() => config.beforeRedirect({ protocol: 'file:', hostname: 'example.com' }))
      .toThrow(PdfFetchError);
  });
});

describe('fetchPdfStream — the body', () => {
  afterEach(() => vi.restoreAllMocks());

  const serve = (headers: Record<string, string>, data: Readable) =>
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, headers, data });
  const fetch = () => fetchPdfStream(new URL('https://publisher.example.com/paper.pdf'), 'ua');
  const read = async (stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200_000, 0x41)]);

  it('closes the publisher\'s side when the reader abandons the download', async () => {
    // Piped, a destroyed destination only paused the source, and the socket
    // to the publisher stayed open for as long as the publisher waited.
    const upstream = new PassThrough();
    upstream.write(Buffer.alloc(1024));
    serve({ 'content-type': 'application/pdf' }, upstream);

    const stream = await fetch();
    stream.destroy();
    await new Promise(resolve => setImmediate(resolve));

    expect(upstream.destroyed).toBe(true);
  });

  it('ends the download, and the publisher\'s side, when the signal aborts mid-body', async () => {
    // Axios hands the stream over at the headers; an abort after that has to
    // reach the stream being read.
    const upstream = new PassThrough();
    upstream.write(Buffer.alloc(1024));
    const get = serve({ 'content-type': 'application/pdf' }, upstream);
    const reader = new AbortController();

    const stream = await fetchPdfStream(new URL('https://publisher.example.com/paper.pdf'), 'ua', reader.signal);
    expect((get.mock.calls[0]![1] as any).signal).toBe(reader.signal);
    const reading = read(stream);
    reader.abort();

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(upstream.destroyed).toBe(true);
  });

  it('rejects with the signal\'s reason, not as an unreachable PDF, when aborted before the headers', async () => {
    const reader = new AbortController();
    vi.spyOn(axios, 'get').mockImplementation(async () => {
      reader.abort();
      throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
    });

    const error = await fetchPdfStream(new URL('https://publisher.example.com/paper.pdf'), 'ua', reader.signal).catch(e => e);
    expect(error).not.toBeInstanceOf(PdfFetchError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('decodes a compressed body, and does not pass on the compressed length', async () => {
    // Axios decoded it and kept Content-Length: a header of 244 bytes in front
    // of a body of 200,009, and the reader got the first 244.
    const gz = gzipSync(pdf);
    const get = serve(
      { 'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': String(gz.length) },
      Readable.from([gz])
    );

    const stream = await fetch();

    expect((await read(stream)).equals(pdf)).toBe(true);
    const config = get.mock.calls[0]![1] as any;
    expect(config.decompress).toBe(false);
    expect(config.headers['Accept-Encoding']).toBe('identity');
  });

  it('reads a body sent as it is', async () => {
    serve({ 'content-type': 'application/pdf', 'content-length': String(pdf.length) }, Readable.from([pdf]));
    const stream = await fetch();
    expect((await read(stream)).length).toBe(pdf.length);
  });

  it('refuses an encoding it cannot read rather than send it as a PDF', async () => {
    const data = Readable.from([Buffer.from('x')]);
    serve({ 'content-type': 'application/pdf', 'content-encoding': 'compress' }, data);
    await expect(fetch()).rejects.toThrow(/in an encoding this cannot read \(compress\)/);
    expect(data.destroyed).toBe(true);
  });
});

/**
 * `servesPdf` is what lets the preprints authority set `verified: true`, so it
 * has to judge by the bytes and nothing else: OSF serves PDFs and Word
 * documents alike as `application/octet-stream`, and a bot wall answers 200
 * with an HTML page as readily as 403.
 */
describe('servesPdf', () => {
  afterEach(() => vi.restoreAllMocks());

  const answer = (status: number, body: string | Buffer) => {
    const data = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]);
    const destroy = vi.spyOn(data, 'destroy');
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status, headers: {}, data });
    return { get, destroy };
  };

  const url = new URL('https://www.researchsquare.com/article/rs-1/v1.pdf');
  const ask = () => servesPdf(url, 'ua', { timeoutMs: 1000 });

  it('is true when the first bytes are a PDF’s', async () => {
    answer(206, '%PDF-1.7\n%âã');
    expect(await ask()).toBe(true);
  });

  it('is false for a file that is not a PDF, whatever it is called', async () => {
    answer(206, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]));
    expect(await ask()).toBe(false);
  });

  it('is false for a page', async () => {
    answer(200, '<!DOCTYPE html><title>Just a moment...</title>');
    expect(await ask()).toBe(false);
  });

  it('is false for a refusal, and does not read it', async () => {
    const { destroy } = answer(403, '<html>blocked</html>');
    expect(await ask()).toBe(false);
    expect(destroy).toHaveBeenCalled();
  });

  it('throws for a server error, which is no answer at all', async () => {
    answer(503, 'unavailable');
    await expect(ask()).rejects.toThrow('HTTP 503');
  });

  it('asks for the first kilobyte, through the guarded agents', async () => {
    const { get } = answer(206, '%PDF-1.4');
    await ask();
    const config = get.mock.calls[0]![1] as any;

    expect(config.headers.Range).toBe('bytes=0-1023');
    expect(config.httpsAgent.options.lookup).toBe(guardedLookup);
    expect(config.httpAgent.options.lookup).toBe(guardedLookup);
  });

  it('stops reading once it has the signature', async () => {
    // A server ignoring the range would otherwise send the whole file.
    const { destroy } = answer(200, Buffer.alloc(64 * 1024, '%PDF-'));
    expect(await ask()).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });
});
