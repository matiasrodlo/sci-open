import { describe, it, expect } from 'vitest';
import { parseTrustProxy, trustsAnyProxy } from '../trust-proxy';

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

  it('reads a hop count as a number', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('passes addresses, CIDRs and named ranges through for proxy-addr', () => {
    expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(parseTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12');
    expect(parseTrustProxy('uniquelocal')).toBe('uniquelocal');
    expect(parseTrustProxy('10.0.0.1, 172.16.0.0/12')).toBe('10.0.0.1, 172.16.0.0/12');
  });

  it('trims surrounding whitespace', () => {
    expect(parseTrustProxy('  loopback  ')).toBe('loopback');
    expect(parseTrustProxy('  3  ')).toBe(3);
  });
});

describe('trustsAnyProxy', () => {
  it('is false only for the off setting', () => {
    // A hop count of 0 is still a configured value, and `''` is already false
    // by the time it gets here — only `false` means "key on the socket".
    expect(trustsAnyProxy(false)).toBe(false);
    expect(trustsAnyProxy(true)).toBe(true);
    expect(trustsAnyProxy(1)).toBe(true);
    expect(trustsAnyProxy('loopback')).toBe(true);
  });
});
