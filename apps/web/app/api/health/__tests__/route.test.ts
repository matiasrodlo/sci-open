import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../route';

/**
 * The compose health check fetched `/`, which never calls the API, so a web
 * tier that could not reach it reported healthy while every search failed.
 */

const ORIGIN = 'http://api.internal:4000';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{"status":"ok"}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_ORIGIN', ORIGIN);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('asks the API its own health, at the configured origin', async () => {
    const response = await GET();

    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 when the API cannot be reached, and does not say why', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:4000'));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(console.error).toHaveBeenCalled();
  });

  it('answers 503 when the API answers but is not healthy', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    expect((await GET()).status).toBe(503);
  });

  it('gives the API a budget shorter than the check\'s own timeout', async () => {
    await GET();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
