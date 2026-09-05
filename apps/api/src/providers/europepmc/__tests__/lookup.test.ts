import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { translate, translateId } from '../translate';
import { lookup } from '../index';

const options = { timeoutMs: 1000 };

/** Trimmed from the live response for PMID 37494408 on 2026-09-04. */
const RECORD = {
  id: '37494408',
  source: 'MED',
  doi: '10.1371/journal.pone.0288686',
  title: "Caregivers' perception and acceptance of malaria vaccine for Children.",
  pubYear: '2023',
  journalInfo: { journal: { title: 'PloS one' } }
};

const page = (result: unknown[]) => ({
  status: 200,
  data: { hitCount: result.length, resultList: { result } }
});

beforeEach(() => {
  get.mockReset();
});

/**
 * The bug this covers: a native id was routed through `translate`, which scopes
 * a bare term to the fields a *keyword* belongs in. Measured live on
 * 2026-09-04, `(TITLE_ABS:37494408 OR MESH:37494408 OR KW:37494408)` returns 0
 * hits and `EXT_ID:"37494408"` returns the record — so every Europe PMC paper
 * URL answered 404, and the frontend only looked right because a click carries
 * the record with it.
 */
describe('translateId', () => {
  it('asks the id field, not the fields a keyword lives in', () => {
    expect(translateId('37494408')).toBe('EXT_ID:"37494408"');
  });

  it('is not what routing the id through translate produces', () => {
    const asKeyword = translate({ terms: ['37494408'], phrases: [], join: 'AND' });

    expect(asKeyword).toContain('TITLE_ABS:');
    expect(asKeyword).not.toContain('EXT_ID');
  });

  it('covers the PMC and preprint id shapes too, which share the field', () => {
    // Verified live: `EXT_ID:"PMC13322439"` and `EXT_ID:"PPR1309569"` each
    // return exactly the record asked about. `normalize` takes `nativeId` from
    // the record's own `id`, so all three shapes arrive here the same way.
    expect(translateId('PMC13322439')).toBe('EXT_ID:"PMC13322439"');
    expect(translateId('PPR1309569')).toBe('EXT_ID:"PPR1309569"');
  });

  it('escapes a quote rather than ending the term early', () => {
    expect(translateId('a"b')).toBe('EXT_ID:"a\\"b"');
  });
});

describe('lookup', () => {
  it('asks for the one record by id', async () => {
    get.mockResolvedValue(page([RECORD]));

    await lookup('37494408', options);

    expect(get.mock.calls[0]![1].params.query).toBe('EXT_ID:"37494408"');
  });

  it('reads a page of one, because the id identifies the record', async () => {
    get.mockResolvedValue(page([RECORD]));

    await lookup('37494408', options);

    expect(get.mock.calls[0]![1].params.pageSize).toBe(1);
  });

  it('normalises the record into a Paper', async () => {
    get.mockResolvedValue(page([RECORD]));

    const paper = await lookup('37494408', options);

    expect(paper?.id).toBe('europepmc:37494408');
    expect(paper?.doi).toBe('10.1371/journal.pone.0288686');
  });

  it('answers null for an id nobody has', async () => {
    get.mockResolvedValue(page([]));

    expect(await lookup('nope', options)).toBeNull();
  });
});
