import { describe, it, expect } from 'vitest';
import { parseTrustProxy, trustProxyWarning, trustsAnyProxy } from '../trust-proxy';

describe('parseTrustProxy', () => {
  it('trusts nothing when unset', () => {
    // The default has to be the safe one: believing X-Forwarded-For from an
    // address that is not a proxy lets any caller choose their own rate-limit
    // key, which is a worse failure than the shared bucket it would fix.
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
  });

  it('reads the booleans', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('refuses a hop count rather than passing it on', () => {
    // Fastify 4 took a number here. Fastify 5 answers one with a function that
    // trusts no address at all — hop-count-only trust cannot validate the
    // immediate peer, so a direct client could spoof `X-Forwarded-*` by
    // supplying enough hops. Failing closed is right upstream; handing the
    // number over would mean a deployment that looks configured, boots
    // cleanly, and silently keys the rate limit on the connecting address.
    expect(parseTrustProxy('1')).toBe(false);
    expect(parseTrustProxy('2')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('passes addresses, CIDRs and named ranges through for proxy-addr', () => {
    expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(parseTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12');
    expect(parseTrustProxy('uniquelocal')).toBe('uniquelocal');
    expect(parseTrustProxy('10.0.0.1, 172.16.0.0/12')).toBe('10.0.0.1, 172.16.0.0/12');
  });

  it('trims surrounding whitespace', () => {
    expect(parseTrustProxy('  loopback  ')).toBe('loopback');
    expect(parseTrustProxy('  3  ')).toBe(false);
  });
});

describe('trustsAnyProxy', () => {
  it('is false only for the off setting', () => {
    expect(trustsAnyProxy(false)).toBe(false);
    expect(trustsAnyProxy(true)).toBe(true);
    expect(trustsAnyProxy('loopback')).toBe(true);
    expect(trustsAnyProxy('10.0.0.1')).toBe(true);
  });
});

describe('trustProxyWarning', () => {
  // A hop count parses to `false`, which `trustsAnyProxy` reports the same way
  // as "unset" — so without this the operator would get the wrong explanation,
  // or none, for a variable they had deliberately set.
  it('explains a hop count that cannot be honoured', () => {
    const warning = trustProxyWarning('2');

    expect(warning).toContain('hop count');
    expect(warning).toContain('Fastify 5');
  });

  it('says nothing about a usable value', () => {
    expect(trustProxyWarning('loopback')).toBeUndefined();
    expect(trustProxyWarning('10.0.0.1')).toBeUndefined();
    expect(trustProxyWarning('true')).toBeUndefined();
  });

  it('says nothing when the variable is simply unset', () => {
    // The caller has its own line for that, and two warnings for one cause
    // would bury the one that names a mistake.
    expect(trustProxyWarning(undefined)).toBeUndefined();
    expect(trustProxyWarning('')).toBeUndefined();
  });
});
