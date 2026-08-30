import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get } }));

import { lookup } from '../index';

const options = { timeoutMs: 1000 };
const ID = 'doi_dedup___::e102f905c7609789b70634cf0ecde7cd';

const record = (objIdentifier: string) => ({
  header: { 'dri:objIdentifier': { $: objIdentifier } },
  metadata: {
    'oaf:entity': {
      'oaf:result': {
        title: { $: 'A study of things' },
        dateofacceptance: { $: '2022-01-01' }
      }
    }
  }
});

const payload = (objIdentifier: string) => ({
  response: { header: { total: { $: 1 } }, results: { result: record(objIdentifier) } }
});

beforeEach(() => {
  get.mockReset();
});

describe('lookup', () => {
  it('asks by openairePublicationID, the only parameter OpenAIRE offers for its own id', async () => {
    // `objIdentifier` is rejected outright — HTTP 400, "Parameter
    // objIdentifier is not supported". The old route sent the id as
    // `keywords`, which matched nothing.
    get.mockResolvedValue({ status: 200, data: payload(ID) });

    await lookup(ID, options);

    expect(get.mock.calls[0]![1].params.openairePublicationID).toBe(ID);
    expect(get.mock.calls[0]![1].params.keywords).toBeUndefined();
  });

  it('returns the record when its own objIdentifier is the one asked for', async () => {
    get.mockResolvedValue({ status: 200, data: payload(ID) });

    expect((await lookup(ID, options))?.id).toBe(`openaire:${ID}`);
  });

  it('rejects a deduplicated sibling, which the parameter also matches', async () => {
    // The parameter expands to `objidentifier exact … or resultdupid exact …`,
    // so a different record can come back. A different record is not this one.
    get.mockResolvedValue({ status: 200, data: payload('doi_dedup___::other') });

    expect(await lookup(ID, options)).toBeNull();
  });

  it('answers null for an id nobody has', async () => {
    get.mockResolvedValue({ status: 200, data: { response: { header: { total: { $: 0 } } } } });

    expect(await lookup(ID, options)).toBeNull();
  });
});
