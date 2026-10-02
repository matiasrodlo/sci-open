import { describe, it, expect } from 'vitest';
import { FullTextCache } from '../cache';
import type { FullTextDocument } from '../types';

const doc = (paperId: string, chars: number): FullTextDocument => ({
  paperId, tier: 'europepmc-jats', url: 'https://example.org', sections: [{ id: 's1', title: 'T', text: 'x'.repeat(chars) }],
  totalChars: chars, retrievedAt: '2026-10-02T00:00:00.000Z'
});

describe('FullTextCache', () => {
  it('holds a document for an hour and a miss for ten minutes', () => {
    let t = 0;
    const cache = new FullTextCache({ now: () => t });
    cache.set('a', doc('a', 10));
    cache.set('b', null);

    t = 599_999;
    expect(cache.get('b')).toBeNull();
    t = 600_000;
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')?.paperId).toBe('a');
    t = 3_600_000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently read when the bytes run out', () => {
    // Each document is 100 chars: 1,224 bytes charged.
    const cache = new FullTextCache({ maxBytes: 2_500 });
    cache.set('a', doc('a', 100));
    cache.set('b', doc('b', 100));
    cache.get('a'); // a is now the most recently read
    cache.set('c', doc('c', 100));

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('serves a document larger than the whole budget without holding it', () => {
    const cache = new FullTextCache({ maxBytes: 1_000 });
    cache.set('big', doc('big', 10_000));
    expect(cache.get('big')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });
});
