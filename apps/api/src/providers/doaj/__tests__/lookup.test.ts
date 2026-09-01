import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
// The pooled client is half of what is under test: its
// `validateStatus: status < 500` means a 404 and a 429 both *resolve*, so the
// status is read from the response rather than caught. Every response below is
// resolved, exactly as the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchArticle } from '../fetch';
import { lookup } from '../index';

const options = { timeoutMs: 1000 };

/**
 * Trimmed from the live response for `0004c647c9864254aaa1ba2acba7f495` on
 * 2026-08-30 — a single article object, not a result page.
 */
const ARTICLE = {
  id: '0004c647c9864254aaa1ba2acba7f495',
  bibjson: {
    title: 'A New Strategy for Efficient Screening',
    year: '2022',
    author: [{ name: 'Wang, Y.' }],
    identifier: [{ type: 'doi', id: '10.3390/v14091878' }],
    link: [{ type: 'fulltext', url: 'https://example.org/a.pdf' }]
  }
};

beforeEach(() => {
  get.mockReset();
});

describe('fetchArticle', () => {
  it('asks the article endpoint, because the search index does not resolve an id', async () => {
    // Measured 2026-08-30: keyword-searching a DOAJ id matches nothing, which
    // is why every "details" click on a DOAJ result used to answer 404.
    get.mockResolvedValue({ data: ARTICLE });

    await fetchArticle('0004c647c9864254aaa1ba2acba7f495', options);

    expect(get.mock.calls[0]![0]).toMatch(/\/articles\/0004c647c9864254aaa1ba2acba7f495$/);
  });

  it('wraps the single article as a one-record page', async () => {
    get.mockResolvedValue({ data: ARTICLE });

    expect(await fetchArticle('x', options)).toEqual({ results: [ARTICLE], total: 1 });
  });

  it('reads a 404 as an empty page rather than an outage', async () => {
    get.mockRejectedValue({ response: { status: 404 } });

    expect(await fetchArticle('nope', options)).toEqual({ results: [], total: 0 });
  });

  it('lets anything else through, because it is not an answer', async () => {
    get.mockRejectedValue({ response: { status: 503 } });

    await expect(fetchArticle('x', options)).rejects.toBeTruthy();
  });
});

describe('lookup', () => {
  it('normalises the article into a Paper', async () => {
    get.mockResolvedValue({ data: ARTICLE });

    const paper = await lookup('0004c647c9864254aaa1ba2acba7f495', options);

    expect(paper?.id).toBe('doaj:0004c647c9864254aaa1ba2acba7f495');
    expect(paper?.doi).toBe('10.3390/v14091878');
  });

  it('answers null for an id nobody has', async () => {
    get.mockRejectedValue({ response: { status: 404 } });

    expect(await lookup('nope', options)).toBeNull();
  });
});
