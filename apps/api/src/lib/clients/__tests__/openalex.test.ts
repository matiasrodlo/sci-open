import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client is the thing under test here, in the sense that its
// `validateStatus: status < 500` is what made a 429 look like a result page.
// Stubbing it keeps that behaviour reproducible offline: every response below
// is *resolved*, never rejected, exactly as the real factory delivers them.
vi.mock('../../http-client-factory', () => ({
  getPooledClient: () => ({ get })
}));

import { OpenAlexClient, OpenAlexUnavailableError } from '../openalex';

/**
 * Recorded from api.openalex.org on 2026-08-29, verbatim, once the daily
 * budget was spent. Kept whole rather than trimmed: `retryAfter` and the
 * human-readable `message` are both read, and the absence of a `results` key
 * is the entire point.
 */
const RATE_LIMITED_BODY = {
  error: 'Rate limit exceeded',
  message:
    'Insufficient budget. This request costs $0.001 but you only have $0 remaining. Resets at midnight UTC. Need more? Add funds at https://openalex.org/pricing',
  retryAfter: 28836,
  costUsd: 0.001,
  dailyRemainingUsd: 0,
  prepaidRemainingUsd: 0,
  creditsRequired: 10,
  creditsRemaining: 0,
  onetimeCreditsRemaining: 0
};

const client = new OpenAlexClient('test/1.0 (mailto:test@example.com)');

const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });

// Braces deliberately. `mockReset()` returns the mock, and an arrow with an
// expression body hands that back to Vitest, which treats a returned function
// as a teardown callback and calls it with no arguments after each test.
beforeEach(() => {
  get.mockReset();
});

describe('searchWorks — a rate-limited response is not a result page', () => {
  it('throws rather than returning a body with no results', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED_BODY));
    await expect(client.searchWorks({ query: 'crispr' })).rejects.toBeInstanceOf(
      OpenAlexUnavailableError
    );
  });

  it('carries the status and the quota reset, so a caller can say why', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED_BODY));

    const error = await client.searchWorks({ query: 'crispr' }).catch(e => e);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(28836);
    // OpenAlex's own words, not ours: a message invented here would be one
    // more thing to keep in step with the API.
    expect(error.message).toContain('Insufficient budget');
  });

  // This is the exact sequence that took the service down: the request
  // resolved, `results` came back undefined, discovery flattened it into the
  // works array, and `.map(w => w.doi)` threw. Asserting on the throw is what
  // stops the payload reaching that code at all.
  it('never hands back a payload whose results are undefined', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED_BODY));

    const settled = await client.searchWorks({ query: 'crispr' }).then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error })
    );

    expect(settled.ok).toBe(false);
  });
});

describe('searchWorks — a 2xx is not enough on its own', () => {
  it('rejects a success that carries no results array', async () => {
    // A 200 with an unexpected body is the same failure wearing a better
    // status code, and the shape is what the caller actually depends on.
    get.mockResolvedValue(resolved(200, { meta: { count: 0 } }));
    await expect(client.searchWorks({ query: 'crispr' })).rejects.toThrow(
      /no results array/
    );
  });

  it('accepts an empty result set, which is a real answer', async () => {
    get.mockResolvedValue(resolved(200, { results: [], meta: { count: 0, page: 1, per_page: 25 } }));

    const response = await client.searchWorks({ query: 'nothing matches this' });
    expect(response.results).toEqual([]);
    expect(response.meta.count).toBe(0);
  });

  it('passes a well-formed page straight through', async () => {
    const work = { id: 'https://openalex.org/W1', title: 'A paper', doi: '10.1/x' };
    get.mockResolvedValue(resolved(200, { results: [work], meta: { count: 1, page: 1, per_page: 25 } }));

    const response = await client.searchWorks({ query: 'crispr' });
    expect(response.results).toHaveLength(1);
    expect(response.results[0].doi).toBe('10.1/x');
  });
});

describe('getWork', () => {
  it('throws on a rate-limited lookup instead of returning the error object', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED_BODY));
    await expect(client.getWork('W1')).rejects.toBeInstanceOf(OpenAlexUnavailableError);
  });

  it('throws when a 2xx carries no work', async () => {
    get.mockResolvedValue(resolved(200, {}));
    await expect(client.getWork('W1')).rejects.toThrow(/no work/);
  });

  it('returns the work when there is one', async () => {
    get.mockResolvedValue(resolved(200, { id: 'https://openalex.org/W1', title: 'A paper' }));
    expect((await client.getWork('W1')).id).toBe('https://openalex.org/W1');
  });
});

describe('getWorkByDOI', () => {
  it('answers null rather than propagating, since a lookup miss is not a failure', async () => {
    get.mockResolvedValue(resolved(429, RATE_LIMITED_BODY));
    expect(await client.getWorkByDOI('10.1/x')).toBeNull();
  });
});
