import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchWorksByDoi, OpenAlexUnavailableError } from '../fetch';

const options = { timeoutMs: 1000, userAgent: 'test/1.0 (mailto:test@example.com)' };

beforeEach(() => {
  get.mockReset();
});

describe('fetchWorksByDoi', () => {
  it('asks for every DOI in one filtered list query', async () => {
    get.mockResolvedValue({ status: 200, data: { results: [], meta: { count: 0 } } });
    await fetchWorksByDoi(['10.1/a', '10.2/b'], options);

    const [path, config] = get.mock.calls[0]!;
    expect(path).toBe('/works');
    expect(config.params).toMatchObject({ filter: 'doi:10.1/a|10.2/b', per_page: 50, page: 1 });
    // The same fields a search reads, so normalize reads these records unchanged.
    expect(config.params.select).toContain('authorships');
  });

  it('refuses more than fifty DOIs, and a DOI the filter would split', async () => {
    await expect(fetchWorksByDoi(Array.from({ length: 51 }, (_, i) => `10.1/${i}`), options)).rejects.toBeInstanceOf(RangeError);
    await expect(fetchWorksByDoi(['10.1/a|b'], options)).rejects.toBeInstanceOf(RangeError);
    await expect(fetchWorksByDoi(['10.1/a,b'], options)).rejects.toBeInstanceOf(RangeError);
    expect(get).not.toHaveBeenCalled();
  });

  it('reports a spent budget as OpenAlex being unavailable, with its status', async () => {
    get.mockResolvedValue({ status: 429, data: { error: 'Rate limit exceeded', message: 'Insufficient budget.' } });
    await expect(fetchWorksByDoi(['10.1/a'], options)).rejects.toMatchObject({ status: 429 });
    await expect(fetchWorksByDoi(['10.1/a'], options)).rejects.toBeInstanceOf(OpenAlexUnavailableError);
  });
});
