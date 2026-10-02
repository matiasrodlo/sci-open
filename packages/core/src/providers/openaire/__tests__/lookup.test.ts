import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
// The pooled client is half of what is under test: its
// `validateStatus: status < 500` means a 404 and a 429 both *resolve*, so the
// status is read from the response rather than caught. Every response below is
// resolved, exactly as the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { lookup } from '../index';

const options = { timeoutMs: 1000 };
const ID = 'doi_dedup___::e102f905c7609789b70634cf0ecde7cd';

const record = (id: string) => ({
  id,
  mainTitle: 'A study of things',
  publicationDate: '2022-01-01'
});

beforeEach(() => {
  get.mockReset();
});

describe('lookup', () => {
  it('asks for the product by path, with the id encoded', async () => {
    // `::` is in every OpenAIRE id. Encoded or not, the Graph API answers the
    // same record — checked live on 2026-09-25 — so it is encoded, as a path
    // segment should be.
    get.mockResolvedValue({ status: 200, data: record(ID) });

    await lookup(ID, options);

    expect(get.mock.calls[0]![0]).toBe(`/researchProducts/${encodeURIComponent(ID)}`);
  });

  it('returns the record when its own id is the one asked for', async () => {
    get.mockResolvedValue({ status: 200, data: record(ID) });

    expect((await lookup(ID, options))?.id).toBe(`openaire:${ID}`);
  });

  it('rejects a different record, whichever route returned it', async () => {
    get.mockResolvedValue({ status: 200, data: record('doi_dedup___::other') });

    expect(await lookup(ID, options)).toBeNull();
  });

  it('answers null for an id nobody has, which the Graph API answers with a 404', async () => {
    get.mockResolvedValue({
      status: 404,
      data: { message: `Research product with id: ${ID} not found`, error: 'Not Found', code: 404 }
    });

    expect(await lookup(ID, options)).toBeNull();
  });

  it('fails rather than answering null when OpenAIRE refuses the request', async () => {
    // A 429 is not "no such paper", and reporting it as one would turn a rate
    // limit into a 404 on the details page.
    get.mockResolvedValue({ status: 429, data: {} });

    await expect(lookup(ID, options)).rejects.toThrow('HTTP 429');
  });
});
