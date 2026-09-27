import { describe, it, expect, vi, beforeEach } from 'vitest';

const pdf = vi.hoisted(() => ({ servesPdf: vi.fn() }));
vi.mock('../../../lib/pdf-proxy', () => pdf);

import { locate, lookup } from '..';
import { AUTHORITIES } from '../../registry';
import { canRescue } from '../../../orchestrator/rescue';
import { paper } from '../../../orchestrator/__tests__/helpers';

/**
 * Each rule below was measured against the live server it names, and each
 * exclusion too — see `locate.ts`. These pin the rules, so a change to one is a
 * change someone has to mean.
 */
describe('locate', () => {
  it('builds Research Square’s address from the article and version', () => {
    expect(locate('10.21203/rs.3.rs-5332173/v1')).toBe('https://www.researchsquare.com/article/rs-5332173/v1.pdf');
    expect(locate('10.21203/RS.3.RS-3355786/V2')).toBe('https://www.researchsquare.com/article/rs-3355786/v2.pdf');
  });

  it('leaves Research Square’s older numbering alone', () => {
    // `rs.2.17932/v2` read as `rs-17932/v2.pdf` is a 404.
    expect(locate('10.21203/rs.2.17932/v2')).toBeUndefined();
  });

  it('builds bioRxiv’s unversioned address, which redirects to the latest version', () => {
    expect(locate('10.1101/2024.08.22.609145')).toBe('https://www.biorxiv.org/content/10.1101/2024.08.22.609145.full.pdf');
    expect(locate('10.1101/461954')).toBe('https://www.biorxiv.org/content/10.1101/461954.full.pdf');
  });

  it('does not mistake medRxiv or a Cold Spring Harbor journal for bioRxiv', () => {
    // medRxiv refuses every address built from a DOI; its numbers run to eight digits.
    expect(locate('10.1101/2024.11.12.24317082')).toBeUndefined();
    expect(locate('10.1101/gr.278373.123')).toBeUndefined();
  });

  it('reads any OSF-hosted server, dropping the version the download cannot take', () => {
    expect(locate('10.31219/osf.io/rqxwv')).toBe('https://osf.io/rqxwv/download');
    expect(locate('10.31234/osf.io/S946W_v1')).toBe('https://osf.io/s946w/download');
    expect(locate('10.35542/osf.io/abc12_v3')).toBe('https://osf.io/abc12/download');
  });

  it('knows nothing of anything else', () => {
    for (const doi of ['10.2139/ssrn.4712743', '10.26434/chemrxiv-2024-g394q', '10.7554/elife.98462.1', '10.1038/nature12373', '', undefined]) {
      expect(locate(doi)).toBeUndefined();
    }
  });
});

describe('lookup', () => {
  beforeEach(() => { pdf.servesPdf.mockReset(); });

  it('offers the server’s copy, verified, once a PDF came back', async () => {
    pdf.servesPdf.mockResolvedValue(true);

    expect(await lookup('10.21203/rs.3.rs-5332173/v1', { timeoutMs: 1000, userAgent: 'ua' })).toEqual({
      fullText: { url: 'https://www.researchsquare.com/article/rs-5332173/v1.pdf', kind: 'pdf', verified: true }
    });
    expect(pdf.servesPdf.mock.calls[0]![1]).toBe('ua');
  });

  it('offers nothing when what came back was not a PDF', async () => {
    pdf.servesPdf.mockResolvedValue(false);
    expect(await lookup('10.31234/osf.io/s946w_v1', { timeoutMs: 1000 })).toBeNull();
  });

  it('asks nothing about a DOI no rule covers', async () => {
    expect(await lookup('10.2139/ssrn.4712743', { timeoutMs: 1000 })).toBeNull();
    expect(pdf.servesPdf).not.toHaveBeenCalled();
  });

  it('lets a failure through, so an outage is not reported as a miss', async () => {
    pdf.servesPdf.mockRejectedValue(new Error('HTTP 503 for osf.io'));
    await expect(lookup('10.31219/osf.io/rqxwv', { timeoutMs: 1000 })).rejects.toThrow('HTTP 503');
  });
});

describe('the registry entry', () => {
  const entry = AUTHORITIES.find(a => a.id === 'preprints')!;

  it('is one the rescue asks', () => {
    expect(canRescue(entry)).toBe(true);
  });

  it('wants only a paper with no copy on a server it knows', () => {
    expect(entry.wants!(paper({ doi: '10.21203/rs.3.rs-1/v1', fullText: undefined }))).toBe(true);
    expect(entry.wants!(paper({ doi: '10.21203/rs.3.rs-1/v1' }))).toBe(false);
    expect(entry.wants!(paper({ doi: '10.1038/nature12373', fullText: undefined }))).toBe(false);
  });

  it('goes beside Unpaywall, with the time a file behind redirects needs', () => {
    expect(entry.pass).toBe(0);
    expect(entry.timeoutMs).toBeGreaterThan(2500);
  });
});
