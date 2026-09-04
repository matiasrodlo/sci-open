import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// Same reasoning as `fetch-work.test.ts`: the pooled client resolves anything
// under 500, so every response below is resolved rather than rejected.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchPage, fetchWork } from '../fetch';

const WORK = { id: 'https://openalex.org/W2741809807', title: 'The state of OA' };
const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });

const base = { timeoutMs: 1000, userAgent: 'test/1.0 (mailto:test@example.com)' };
const pageOptions = { ...base, pageSize: 25, offset: 0 };

const sentTo = (call: number) => get.mock.calls[call]![1] as {
  headers: Record<string, string>;
  params: Record<string, unknown>;
};

beforeEach(() => {
  get.mockReset();
});

describe('the OpenAlex API key', () => {
  it('goes out as a bearer token on a search', async () => {
    get.mockResolvedValue(resolved(200, { results: [WORK] }));

    await fetchPage({ search: 'crispr' }, { ...pageOptions, apiKey: 'oa-key-123' });

    expect(sentTo(0).headers.Authorization).toBe('Bearer oa-key-123');
  });

  it('goes out on the entity endpoint too, which is billed as well', async () => {
    get.mockResolvedValue(resolved(200, WORK));

    await fetchWork('W2741809807', { ...base, apiKey: 'oa-key-123' });

    expect(sentTo(0).headers.Authorization).toBe('Bearer oa-key-123');
  });

  it('stays out of the query string, where the URL would carry it into the logs', async () => {
    // OpenAlex accepts `?api_key=`, and that is exactly the form that ends up
    // in an access log and in the pool's per-service metrics.
    get.mockResolvedValue(resolved(200, { results: [WORK] }));

    await fetchPage({ search: 'crispr' }, { ...pageOptions, apiKey: 'oa-key-123' });

    expect(sentTo(0).params.api_key).toBeUndefined();
    expect(JSON.stringify(sentTo(0).params)).not.toContain('oa-key-123');
  });

  it('is absent, rather than empty, when none is configured', async () => {
    // An anonymous request is a smaller budget. A request carrying
    // `Authorization: Bearer undefined` is a rejected one.
    get.mockResolvedValue(resolved(200, { results: [WORK] }));

    await fetchPage({ search: 'crispr' }, pageOptions);

    expect(sentTo(0).headers).not.toHaveProperty('Authorization');
  });

  it('is not sent when it is still the placeholder from the sample env file', async () => {
    // `usableApiKey`'s reason, applied here: a `.env` copied from
    // `docs/env.example` has the placeholder in every slot, and a wrong
    // credential is worse than none.
    get.mockResolvedValue(resolved(200, { results: [WORK] }));

    await fetchPage(
      { search: 'crispr' },
      { ...pageOptions, apiKey: 'your_openalex_api_key_here' }
    );

    expect(sentTo(0).headers).not.toHaveProperty('Authorization');
  });

  it('leaves the polite-pool mailto alone', async () => {
    // The key and the contact email answer different things — budget and pool —
    // and both are meant to go out together.
    get.mockResolvedValue(resolved(200, { results: [WORK] }));

    await fetchPage({ search: 'crispr' }, { ...pageOptions, apiKey: 'oa-key-123' });

    expect(sentTo(0).params.mailto).toBe('test@example.com');
  });
});
