import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { searchPapers } from '../fetcher';
import type { SearchParams } from '@open-access-explorer/shared';

/**
 * A server-rendered search has to say who it is for.
 *
 * `/results` is a server component and `Pagination` navigates by URL, so every
 * search in the product is issued from the Next process rather than from the
 * reader's browser — straight to `API_ORIGIN`, not through
 * `app/api/[...path]/route.ts`. That handler forwards `x-forwarded-for`, and
 * this path did not, so the API's rate limit keyed every search on the web
 * tier: `RATE_LIMIT_MAX` was the search budget of the whole site rather than of
 * one visitor, and one script could spend it for everybody.
 *
 * The route handler has a test making the same assertion for the browser path,
 * for the same reason: it is one line, and it looks removable to anyone who
 * does not know what it holds up.
 */

vi.mock('axios', () => ({
  default: { post: vi.fn(async () => ({ data: {} })), get: vi.fn(async () => ({ data: {} })) }
}));

const post = vi.mocked(axios.post);

/** What `axios.post` was handed, as body plus config. */
const called = () => ({
  body: post.mock.calls[0]![1] as SearchParams,
  config: post.mock.calls[0]![2] as { headers: Record<string, string> }
});

const params: SearchParams = { q: 'crispr', page: 1, pageSize: 20 };

beforeEach(() => {
  post.mockClear();
});

describe('searchPapers', () => {
  it('forwards the caller the API rate limit keys on', async () => {
    await searchPapers(params, { forwardedFor: '203.0.113.7, 198.51.100.2' });

    expect(called().config.headers['x-forwarded-for']).toBe('203.0.113.7, 198.51.100.2');
  });

  it('invents no chain when it was given none', async () => {
    // A server component cannot see its own socket, exactly as a route handler
    // cannot. The chain has to be started by a real proxy in front of this app;
    // making one up here would hand the API an address it should not believe.
    await searchPapers(params);

    expect(called().config.headers['x-forwarded-for']).toBeUndefined();
  });

  it('still sends the search itself as the body', async () => {
    // The caller is a third argument precisely so adding it could not displace
    // this one.
    await searchPapers(params, { forwardedFor: '203.0.113.7' });

    expect(called().body).toEqual(params);
  });
});
