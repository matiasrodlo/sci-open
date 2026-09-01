import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// pdf-proxy binds `promisify(dns.lookup)` at import time, so the resolver has
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
  PdfProxyError,
  SSRF_REFUSED
} from '../pdf-proxy';

/**
 * The PDF proxy takes its URL from the browser, so without these checks the
 * endpoint is an open proxy into whatever the API server can reach — including
 * cloud instance metadata at 169.254.169.254 and anything on the private
 * network. This is the highest-value suite in the repo: every case below is a
 * request an attacker would actually send.
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
    expect(blocked(ip)).toThrow(PdfProxyError);
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
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address']
  ])('blocks %s (%s)', ip => {
    expect(blocked(ip)).toThrow(PdfProxyError);
  });

  it('allows a public IPv6 address', () => {
    expect(blocked('2606:4700:4700::1111')).not.toThrow();
  });

  it('unwraps bracketed IPv6 literals before checking them', () => {
    expect(blocked('[::1]')).toThrow(PdfProxyError);
  });
});

describe('assertRoutableHostSync — hostnames', () => {
  it.each(['localhost', 'foo.localhost', 'db.internal', 'printer.local', 'host.localdomain', 'router.home.arpa'])(
    'blocks %s',
    host => expect(blocked(host)).toThrow(PdfProxyError)
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
      await expect(assertPublicHttpUrl(url)).rejects.toThrow(PdfProxyError);
    }
  );

  it('rejects a malformed URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(PdfProxyError);
  });

  it('rejects a loopback URL without needing DNS', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/secret')).rejects.toThrow(PdfProxyError);
  });

  it('rejects the cloud metadata endpoint', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      PdfProxyError
    );
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
    await expect(assertPublicHttpUrl('https://evil.example.com/x.pdf')).rejects.toThrow(PdfProxyError);
  });

  it('rejects when any resolved address is private, not just the first', async () => {
    resolver.addresses = [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    await expect(assertPublicHttpUrl('https://split.example.com/x.pdf')).rejects.toThrow(PdfProxyError);
  });

  it('rejects a host that resolves to nothing at all', async () => {
    resolver.addresses = [];
    await expect(assertPublicHttpUrl('https://empty.example.com/x.pdf')).rejects.toThrow(PdfProxyError);
  });

  it('rejects a host whose lookup fails', async () => {
    resolver.error = new Error('ENOTFOUND');
    await expect(assertPublicHttpUrl('https://missing.example.com/x.pdf')).rejects.toThrow(PdfProxyError);
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

    expect(err).toBeInstanceOf(PdfProxyError);
    expect(err.statusCode).toBe(403);
  });

  it('refuses the cloud metadata address', async () => {
    resolver.addresses = [{ address: '169.254.169.254' }];
    expect((await lookup()).err).toBeInstanceOf(PdfProxyError);
  });

  it('refuses when any address in the answer is private, not just the first', async () => {
    // Connecting to whichever address happened to be public would be the whole
    // hole again, one DNS answer later.
    resolver.addresses = [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    expect((await lookup()).err).toBeInstanceOf(PdfProxyError);
  });

  it('refuses a name that resolves to nothing', async () => {
    resolver.addresses = [];
    expect((await lookup()).err).toBeInstanceOf(PdfProxyError);
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
  // "502, could not reach the PDF", which reads like an upstream outage rather
  // than a request we declined to make.
  it('finds a refusal wrapped two layers deep', () => {
    const wrapped = Object.assign(new Error('Request failed'), {
      cause: Object.assign(new Error('Redirected request failed: refused'), {
        cause: Object.assign(new Error('Refusing to download from a non-public address'), {
          code: SSRF_REFUSED
        })
      })
    });

    const found = ssrfRefusalIn(wrapped);
    expect(found).toBeInstanceOf(PdfProxyError);
    expect(found!.statusCode).toBe(403);
    expect(found!.message).toBe('Refusing to download from a non-public address');
  });

  it('finds one that was not wrapped at all', () => {
    const bare = Object.assign(new Error('Refusing to download from a non-public address'), {
      code: SSRF_REFUSED
    });
    expect(ssrfRefusalIn(bare)).toBeInstanceOf(PdfProxyError);
  });

  it('leaves an ordinary transport failure alone', () => {
    // A real upstream outage has to stay a 502, or the endpoint reports every
    // failure as a refusal.
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
      .toThrow(PdfProxyError);
    expect(() => config.beforeRedirect({ protocol: 'file:', hostname: 'example.com' }))
      .toThrow(PdfProxyError);
  });
});
