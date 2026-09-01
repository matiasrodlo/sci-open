import { describe, it, expect } from 'vitest';
import { httpUrl, isHttpUrl } from '../url';

/**
 * Provider metadata is not trusted input. CORE and OpenAIRE index repository
 * deposits, so the URL fields are written by whoever deposited the record, and
 * nothing downstream — not the normalisers, not the frontend — checked the
 * scheme before handing the value to `window.open`.
 */
describe('httpUrl', () => {
  it.each([
    ['javascript:alert(document.domain)//evil.pdf', 'the measured CORE bypass'],
    ['JavaScript:alert(1)', 'scheme comparison is case-insensitive in the URL parser'],
    ['data:text/html,<script>alert(1)</script>#x.pdf', 'data URL ending in .pdf'],
    ['vbscript:msgbox(1)', 'legacy script scheme'],
    ['file:///etc/passwd', 'local file'],
    ['ftp://example.com/paper.pdf', 'not a web address'],
    ['blob:https://example.com/1234', 'blob'],
    ['//example.com/paper.pdf', 'protocol-relative — no scheme to check'],
    ['/articles/1.pdf', 'relative path'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
    ['   ', 'whitespace only']
  ])('rejects %s (%s)', value => {
    expect(httpUrl(value)).toBeUndefined();
  });

  it.each([undefined, null, 42, {}, [], true])('rejects the non-string %s', value => {
    expect(httpUrl(value)).toBeUndefined();
  });

  it.each([
    'https://example.com/paper.pdf',
    'http://example.com/paper.pdf',
    'https://europepmc.org/articles/PMC123?pdf=render',
    'https://doi.org/10.1371/journal.pone.0000001',
    'https://example.com/a b.pdf',
    'HTTPS://EXAMPLE.COM/PAPER.PDF'
  ])('accepts %s', value => {
    expect(httpUrl(value)).toBe(value);
  });

  it('returns the URL as given rather than a re-serialised one', () => {
    // Normalising here would change what a provider said the URL was, and the
    // proxy resolves and rewrites on its own terms. This only decides whether
    // the value is usable at all.
    const raw = 'https://example.com/path?b=2&a=1#frag';
    expect(httpUrl(raw)).toBe(raw);
  });

  it('trims surrounding whitespace', () => {
    expect(httpUrl('  https://example.com/p.pdf  ')).toBe('https://example.com/p.pdf');
  });

  it('isHttpUrl agrees with httpUrl', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
