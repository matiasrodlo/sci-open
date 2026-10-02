import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { doiRegistered } from '../doi-registry';

/**
 * The DOI system's own answer to "was this DOI ever minted", which is what
 * tells a fabricated DOI from a real one no search source happens to index.
 * Response codes as the Handle API returns them, checked against it on
 * 2026-10-02 for a Crossref DOI, a DataCite one and a Zenodo DOI never minted.
 */

beforeEach(() => {
  get.mockReset();
});

describe('doiRegistered', () => {
  it('is true for a handle the registry holds', async () => {
    get.mockResolvedValue({ status: 200, data: { responseCode: 1, handle: '10.48550/arXiv.1706.03762' } });

    expect(await doiRegistered('10.48550/arXiv.1706.03762', { userAgent: 'test' })).toBe(true);
  });

  it('is false for a handle never minted', async () => {
    get.mockResolvedValue({ status: 404, data: { responseCode: 100, handle: '10.5281/zenodo.1234' } });

    expect(await doiRegistered('10.5281/zenodo.1234', { userAgent: 'test' })).toBe(false);
  });

  it('knows nothing when the registry fails or answers something else', async () => {
    get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await doiRegistered('10.1371/journal.pone.0000217', { userAgent: 'test' })).toBeUndefined();

    get.mockResolvedValueOnce({ status: 500, data: '<html>' });
    expect(await doiRegistered('10.1371/journal.pone.0000217', { userAgent: 'test' })).toBeUndefined();
  });

  it('encodes each part of the handle but keeps the slashes between them', async () => {
    get.mockResolvedValue({ status: 200, data: { responseCode: 1 } });

    await doiRegistered('10.1002/(SICI)1097-4636#x', { userAgent: 'test' });

    expect(get.mock.calls[0]![0]).toBe('/api/handles/10.1002/(SICI)1097-4636%23x');
  });
});
