import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client is half of what is under test: its
// `validateStatus: status < 500` means a 404 and a 429 both *resolve*, so the
// status has to be read from the response rather than caught. Every response
// below is resolved, exactly as the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchWork, OpenAlexUnavailableError } from '../fetch';

const options = { timeoutMs: 1000, userAgent: 'test/1.0 (mailto:test@example.com)' };
const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });

const WORK = { id: 'https://openalex.org/W2741809807', title: 'The state of OA' };

/**
 * Recorded from api.openalex.org on 2026-08-30, once the daily budget was
 * spent. The absence of a work is the point: without a status check this body
 * reads as a record and reaches `normalize`.
 */
const RATE_LIMITED = {
  error: 'Rate limit exceeded',
  message: 'Insufficient budget. This request costs $0.0001 but you only have $0 remaining.',
  retryAfter: 10422
};

// Braces deliberately: `mockReset()` returns the mock, and an arrow with an
// expression body hands that back to Vitest, which calls it as a teardown.
beforeEach(() => {
  get.mockReset();
});

describe('fetchWork', () => {
  it('wraps the single work as a one-record page, which normalize already reads', async () => {
    get.mockResolvedValue(resolved(200, WORK));

    expect(await fetchWork('W2741809807', options)).toEqual({ results: [WORK] });
  });

  it('asks the entity endpoint, not a filtered search', async () => {
    // Price, not style. Measured 2026-08-30 against a spent budget:
    // `/works?filter=ids.openalex:…` answered `Insufficient budget` while
    // `/works/W2741809807` returned the record.
    get.mockResolvedValue(resolved(200, WORK));

    await fetchWork('W2741809807', options);

    expect(get.mock.calls[0]![0]).toBe('/works/W2741809807');
    expect(get.mock.calls[0]![1].params.filter).toBeUndefined();
  });

  it('strips a full OpenAlex URL, which is what old links carry', async () => {
    // The route this replaces wrote `work.id` — the URL — into `OARecord.id`.
    get.mockResolvedValue(resolved(200, WORK));

    await fetchWork('https://openalex.org/W2741809807', options);

    expect(get.mock.calls[0]![0]).toBe('/works/W2741809807');
  });

  it('reads a 404 as an empty page rather than an outage', async () => {
    // An id nobody has is an answer. The endpoint returns 404 and the pooled
    // client resolves it.
    get.mockResolvedValue(resolved(404, { error: 'Not found' }));

    expect(await fetchWork('W0', options)).toEqual({ results: [] });
  });

  it('throws on a rate-limited lookup instead of returning the error object', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED));

    await expect(fetchWork('W1', options)).rejects.toThrow(OpenAlexUnavailableError);
    await expect(fetchWork('W1', options)).rejects.toThrow(/Insufficient budget/);
  });

  it('throws when a 2xx carries no work', async () => {
    get.mockResolvedValue(resolved(200, { meta: {} }));

    await expect(fetchWork('W1', options)).rejects.toThrow(/carrying no work/);
  });

  it('asks for the fields normalize reads', async () => {
    get.mockResolvedValue(resolved(200, WORK));

    await fetchWork('W1', options);

    const select = get.mock.calls[0]![1].params.select as string;
    for (const field of ['topics', 'best_oa_location', 'abstract_inverted_index', 'open_access']) {
      expect(select).toContain(field);
    }
  });
});
