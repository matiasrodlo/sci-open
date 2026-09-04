import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client is half of what is under test: its
// `validateStatus: status < 500` means a 404 resolves rather than throwing, so
// the status is read from the response. Every response below is resolved,
// exactly as the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { lookupDoi, UnpaywallUnidentifiedError } from '../fetch';

const options = { timeoutMs: 1000, userAgent: 'test/1.0 (mailto:test@example.com)' };
const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });

const pathAsked = () => get.mock.calls[0]![0] as string;

beforeEach(() => {
  get.mockReset();
});

describe('lookupDoi', () => {
  it('asks for the DOI under /v2, keeping its own slash a path separator', async () => {
    // Not a bare encodeURIComponent, which is what Crossref's client uses: the
    // endpoint is `/v2/{doi}`, so the slash between a DOI's prefix and suffix
    // is structural and has to survive.
    get.mockResolvedValue(resolved(200, { doi: '10.1038/srep09811' }));

    await lookupDoi('10.1038/srep09811', options);

    expect(pathAsked()).toBe('/10.1038/srep09811');
  });

  it('escapes a DOI ending in #, rather than asking about a different work', async () => {
    // Wiley's SICI-derived DOIs end in `#`, and `#` is structural in a URL: the
    // raw form reached the wire as `…3.3.CO;2-` with the fragment marker and
    // everything after it dropped, so Unpaywall answered about a DOI nobody
    // had asked for.
    //
    // The cost is not a missing field. Unpaywall is the only authority
    // authoritative on `fullText` and `oaStatus`, so a lookup that misses
    // leaves the paper failing `passesPolicy` — dropped from `total` and from
    // the facets rather than merely under-described.
    const doi = '10.1002/1521-3773(20010316)40:6<9::AID-ANIE9>3.3.CO;2-#';
    get.mockResolvedValue(resolved(200, { doi }));

    await lookupDoi(doi, options);

    const asked = pathAsked();
    expect(asked).toBe('/10.1002/1521-3773(20010316)40%3A6%3C9%3A%3AAID-ANIE9%3E3.3.CO%3B2-%23');
    // The whole DOI travelled: nothing was cut at the fragment marker.
    expect(asked.endsWith('%23')).toBe(true);
  });

  it('escapes a DOI containing ?, which would otherwise start a query string', async () => {
    const doi = '10.1234/foo?bar';
    get.mockResolvedValue(resolved(200, { doi }));

    await lookupDoi(doi, options);

    expect(pathAsked()).toBe('/10.1234/foo%3Fbar');
  });

  it('sends the contact address Unpaywall requires', async () => {
    get.mockResolvedValue(resolved(200, { doi: '10.1038/srep09811' }));

    await lookupDoi('10.1038/srep09811', options);

    expect(get.mock.calls[0]![1].params).toEqual({ email: 'test@example.com' });
  });

  it('refuses to ask without an address, rather than collecting a page of 422s', async () => {
    await expect(lookupDoi('10.1038/srep09811', { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      UnpaywallUnidentifiedError
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('treats a 404 as an answer', async () => {
    get.mockResolvedValue(resolved(404, {}));

    expect(await lookupDoi('10.0000/nope', options)).toBeNull();
  });

  it('treats a 200 carrying no doi as no record', async () => {
    // A malformed DOI answers 200 with an `error` key rather than a record.
    get.mockResolvedValue(resolved(200, { error: true, message: 'Invalid DOI' }));

    expect(await lookupDoi('not-a-doi', options)).toBeNull();
  });
});
