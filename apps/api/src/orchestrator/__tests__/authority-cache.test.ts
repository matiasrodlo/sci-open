import { describe, it, expect, vi } from 'vitest';
import { AuthorityCache } from '../authority-cache';

describe('AuthorityCache', () => {
  it('asks once for one authority and one DOI', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn(async () => ({ publisher: 'Springer' }));

    await cache.fetch('unpaywall', '10.1/a', lookup);
    await cache.fetch('unpaywall', '10.1/a', lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('collapses two concurrent lookups of the same DOI onto one request', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn(async () => ({ publisher: 'Springer' }));

    const [a, b] = await Promise.all([
      cache.fetch('unpaywall', '10.1/a', lookup),
      cache.fetch('unpaywall', '10.1/a', lookup)
    ]);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('keeps a null answer, which is a fact like any other', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn(async () => null);

    await cache.fetch('unpaywall', '10.1/a', lookup);
    expect(await cache.fetch('unpaywall', '10.1/a', lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('separates authorities asking about the same DOI', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn(async () => ({}));

    await cache.fetch('unpaywall', '10.1/a', lookup);
    await cache.fetch('crossref', '10.1/a', lookup);

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('matches a DOI whatever case it arrives in', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn(async () => ({}));

    await cache.fetch('unpaywall', '10.1/A', lookup);
    await cache.fetch('unpaywall', '10.1/a', lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('forgets a failure, so a transient one does not deny the page a fact', async () => {
    const cache = new AuthorityCache();
    const lookup = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ publisher: 'Springer' });

    await expect(cache.fetch('unpaywall', '10.1/a', lookup)).rejects.toThrow('ECONNRESET');
    expect(await cache.fetch('unpaywall', '10.1/a', lookup)).toEqual({ publisher: 'Springer' });
  });
});
