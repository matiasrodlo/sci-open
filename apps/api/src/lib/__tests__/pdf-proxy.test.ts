import { describe, it, expect, vi, beforeEach } from 'vitest';

// pdf-proxy binds `promisify(dns.lookup)` at import time, so the resolver has
// to be replaced at module level rather than spied on afterwards.
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

import { assertRoutableHostSync, assertPublicHttpUrl, PdfProxyError } from '../pdf-proxy';

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
