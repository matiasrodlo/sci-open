import { describe, it, expect, vi, beforeEach } from 'vitest';
import recorded from '../__fixtures__/peerj-cs-421.json';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client resolves a 4xx rather than throwing, so every response
// below is resolved, as the real factory delivers them.
vi.mock('../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { citationLinks, idsIn, OpenCitationsUnavailableError } from '../opencitations';

const options = { userAgent: 'test/1.0 (mailto:test@example.com)' };
const resolved = (status: number, data: unknown) => ({ status, statusText: status === 503 ? 'Service Unavailable' : '', data });

beforeEach(() => {
  get.mockReset();
});

describe('idsIn', () => {
  it('reads every DOI, the PMID and the OpenAlex id, whatever their order', () => {
    expect(idsIn('omid:br/06101801781 doi:10.7717/peerj-cs.421 openalex:W3134956838 pmid:33817056')).toEqual({
      dois: ['10.7717/peerj-cs.421'], pmid: '33817056', openalex: 'W3134956838'
    });
  });

  it('keeps both DOIs of a work listed twice, in the order given', () => {
    // The preprint first, the published article second: the first is not
    // reliably the publisher's, so neither is dropped.
    expect(idsIn('omid:br/06101802023 pmid:33816816 doi:10.7287/peerj.preprints.26727v1 doi:10.7717/peerj-cs.163').dois)
      .toEqual(['10.7287/peerj.preprints.26727v1', '10.7717/peerj-cs.163']);
  });

  it('reads an empty or bare list as no identifiers', () => {
    expect(idsIn('')).toEqual({ dois: [] });
    expect(idsIn('omid:br/1 doi: pmid:')).toEqual({ dois: [] });
  });
});

describe('citationLinks', () => {
  it('reads a paper’s citers from the citing end, with their dates and flags', async () => {
    get.mockResolvedValue(resolved(200, recorded.citations));
    const links = await citationLinks('10.7717/peerj-cs.421', 'cited_by', options);

    expect(get.mock.calls[0]![0]).toBe('/citations/doi:10.7717%2Fpeerj-cs.421');
    expect(links).toEqual([
      { dois: ['10.48366/r109904'], openalex: 'W6910306851', created: '2021', journalSelfCitation: false, authorSelfCitation: true },
      { dois: ['10.1177/09610006211036734'], openalex: 'W3189909973', created: '2021-08-04', journalSelfCitation: false, authorSelfCitation: false },
      { dois: ['10.1063/5.0110347'], openalex: 'W4322579315', created: '2023', journalSelfCitation: false, authorSelfCitation: false }
    ]);
  });

  it('reads a paper’s references from the cited end, without the paper’s own date on each', async () => {
    get.mockResolvedValue(resolved(200, recorded.references));
    const links = await citationLinks('10.7717/peerj-cs.421', 'references', options);

    expect(get.mock.calls[0]![0]).toBe('/references/doi:10.7717%2Fpeerj-cs.421');
    expect(links[0]).toEqual({
      dois: ['10.7287/peerj.preprints.26727v1', '10.7717/peerj-cs.163'], pmid: '33816816',
      journalSelfCitation: true, authorSelfCitation: false
    });
    expect(links.every(l => l.created === undefined)).toBe(true);
  });

  it('sends the token when there is one, and only then', async () => {
    get.mockResolvedValue(resolved(200, []));
    await citationLinks('10.1/x', 'cited_by', options);
    await citationLinks('10.1/x', 'cited_by', { ...options, token: 'secret-token' });

    expect(get.mock.calls[0]![1].headers.authorization).toBeUndefined();
    expect(get.mock.calls[1]![1].headers.authorization).toBe('secret-token');
  });

  it('reads an unknown DOI’s empty list as no links', async () => {
    get.mockResolvedValue(resolved(200, []));
    expect(await citationLinks('10.9999/nobody', 'cited_by', options)).toEqual([]);
  });

  it('throws on an error status or a body that is not a list', async () => {
    get.mockResolvedValue(resolved(503, '<html>'));
    await expect(citationLinks('10.1/x', 'cited_by', options)).rejects.toBeInstanceOf(OpenCitationsUnavailableError);
    get.mockResolvedValue(resolved(200, { error: 'nope' }));
    await expect(citationLinks('10.1/x', 'cited_by', options)).rejects.toThrow(/carrying no list/);
  });
});
