import { describe, it, expect, vi } from 'vitest';
import { AuthorityCache, AuthorityFactsCache } from '../authority-cache';

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

/**
 * What the authorities said, held across searches. A page shown again — page 2
 * and back to page 1 — used to be asked about again, twenty lookups at a time.
 */
describe('AuthorityFactsCache', () => {
  const facts = { citationCount: 7 };

  it('answers a later search from what an earlier one was told', async () => {
    const held = new AuthorityFactsCache();
    const work = vi.fn(async () => facts);

    expect(await new AuthorityCache(held).fetch('crossref', '10.1/A', work)).toBe(facts);
    expect(await new AuthorityCache(held).fetch('crossref', '10.1/a', work)).toBe(facts);
    expect(work).toHaveBeenCalledOnce();
  });

  it('holds "nothing known" as an answer', async () => {
    const held = new AuthorityFactsCache();
    const work = vi.fn(async () => null);

    await new AuthorityCache(held).fetch('unpaywall', '10.1/x', work);
    expect(await new AuthorityCache(held).fetch('unpaywall', '10.1/x', work)).toBeNull();
    expect(work).toHaveBeenCalledOnce();
  });

  it('never holds a failure, so an outage is not remembered past it', async () => {
    const held = new AuthorityFactsCache();
    await expect(new AuthorityCache(held).fetch('unpaywall', '10.1/x', async () => {
      throw new Error('503');
    })).rejects.toThrow('503');

    expect(held.get('unpaywall', '10.1/x')).toBeUndefined();
  });

  it('lets an answer go after its time', () => {
    let now = 0;
    const held = new AuthorityFactsCache({ ttlMs: 1000, now: () => now });
    held.set('crossref', '10.1/a', facts);

    now = 999;
    expect(held.get('crossref', '10.1/a')).toBe(facts);
    now = 1000;
    expect(held.get('crossref', '10.1/a')).toBeUndefined();
  });

  it('lets the least recently used answer go first when full', () => {
    const held = new AuthorityFactsCache({ maxEntries: 2 });
    held.set('crossref', '10.1/a', facts);
    held.set('crossref', '10.1/b', facts);
    held.get('crossref', '10.1/a');
    held.set('crossref', '10.1/c', facts);

    expect(held.get('crossref', '10.1/a')).toBe(facts);
    expect(held.get('crossref', '10.1/b')).toBeUndefined();
    expect(held.size).toBe(2);
  });
});
