import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
// The pooled client is half of what is under test: its
// `validateStatus: status < 500` means a 404 and a 429 both *resolve*, so the
// status is read from the response rather than caught. Every response below is
// resolved, exactly as the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { lookup } from '../index';

const options = { timeoutMs: 1000 };

const work = (id: number) => ({
  id,
  title: 'Rapid generation of endogenously driven transcriptional reporters',
  authors: [{ name: 'Dewari, P.' }],
  yearPublished: 2015
});

beforeEach(() => {
  get.mockReset();
});

describe('lookup', () => {
  it('asks the search endpoint with an id clause, not /works/{id}', async () => {
    // `/v3/works/8657725` answers HTTP 500, measured 2026-08-30, where
    // `q=id:8657725` returns exactly that one record.
    get.mockResolvedValue({ status: 200, data: { results: [work(8657725)], totalHits: 1 } });

    await lookup('8657725', options);

    expect(get.mock.calls[0]![0]).toMatch(/\/search\/works\/$/);
    expect(get.mock.calls[0]![1].params.q).toBe('id:8657725');
  });

  it('returns the record when the id matches', async () => {
    get.mockResolvedValue({ status: 200, data: { results: [work(8657725)], totalHits: 1 } });

    expect((await lookup('8657725', options))?.id).toBe('core:8657725');
  });

  it('answers null rather than a record with a different id', async () => {
    get.mockResolvedValue({ status: 200, data: { results: [work(999)], totalHits: 1 } });

    expect(await lookup('8657725', options)).toBeNull();
  });

  it('answers null for an id nobody has', async () => {
    get.mockResolvedValue({ status: 200, data: { results: [], totalHits: 0 } });

    expect(await lookup('8657725', options)).toBeNull();
  });
});
