import { describe, it, expect, vi, afterEach } from 'vitest';
import { openExternal, externalHref } from '../external-link';

/**
 * `bestPdfUrl` and `landingPage` come from provider metadata, and CORE and
 * OpenAIRE index repository deposits — so those fields are written by whoever
 * deposited the record. `window.open('javascript:...')` runs in the opener's
 * origin, and a `_blank` window opened this way keeps a live `window.opener`
 * and can navigate the tab it came from.
 */
describe('openExternal', () => {
  afterEach(() => vi.unstubAllGlobals());

  const spy = () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    return open;
  };

  it.each([
    'javascript:alert(document.domain)//evil.pdf',
    'data:text/html,<script>alert(1)</script>#x.pdf',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//example.com/x.pdf',
    'not a url',
    '',
    undefined,
    null
  ])('refuses %s without opening anything', value => {
    const open = spy();
    expect(openExternal(value as any)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a normal PDF URL', () => {
    const open = spy();
    expect(openExternal('https://example.com/paper.pdf')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/paper.pdf', '_blank', 'noopener,noreferrer');
  });

  it('always detaches the opener', () => {
    // The half that is not about the scheme: without `noopener` the opened page
    // can navigate the tab it came from. `window.open` never got the implicit
    // noopener that browsers gave `<a target="_blank">`.
    const open = spy();
    openExternal('http://example.com/a.pdf');
    const features = open.mock.calls[0][2] as string;
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('reports on the URL rather than the tab', () => {
    // `noopener` makes window.open return null by specification, so a caller
    // testing the handle would show an error for every download that opened.
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    expect(openExternal('https://example.com/paper.pdf')).toBe(true);
  });
});

describe('externalHref', () => {
  it('drops a scripted href', () => {
    // React renders a `javascript:` href with a warning rather than refusing it.
    expect(externalHref('javascript:alert(1)')).toBeUndefined();
  });

  it('keeps a real one', () => {
    expect(externalHref('https://doi.org/10.1/abc')).toBe('https://doi.org/10.1/abc');
  });
});
