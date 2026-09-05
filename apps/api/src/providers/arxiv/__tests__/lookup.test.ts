import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { translate } from '../translate';
import { fetchRecord } from '../fetch';
import { lookup } from '../index';

const options = { timeoutMs: 1000 };

/** Modelled on the live feed for `id_list=1706.03762`, read on 2026-09-04. */
const FEED =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">' +
  '<entry>' +
  '<id>http://arxiv.org/abs/1706.03762v7</id>' +
  '<title>Attention Is All You Need</title>' +
  '<summary>Body text.</summary>' +
  '<published>2017-06-12T00:00:00Z</published>' +
  '<author><name>Ashish Vaswani</name></author>' +
  '<link href="https://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf" title="pdf"/>' +
  '</entry></feed>';

/** What arXiv answers for a well-formed id it does not have: no entries. */
const EMPTY =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<feed xmlns="http://www.w3.org/2005/Atom"></feed>';

const ok = (xml: string) => ({ status: 200, data: xml });

beforeEach(() => {
  get.mockReset();
});

/**
 * The bug this covers: an arXiv identifier appears in no searchable field, so
 * routing a native id through `translate` — which is what happened before this
 * provider had a `lookup` — asks `(ti:1706.03762 OR abs:1706.03762 OR …)` and
 * matches nothing. Every arXiv paper URL answered 404.
 */
describe('fetchRecord', () => {
  it('names the record with id_list rather than searching for it', async () => {
    get.mockResolvedValue(ok(FEED));

    await fetchRecord('1706.03762', options);

    expect(get.mock.calls[0]![1].params).toMatchObject({ id_list: '1706.03762' });
    expect(get.mock.calls[0]![1].params.search_query).toBeUndefined();
  });

  it('is a different parameter from the one a query would use', () => {
    // Not a query written differently: `translate` has no way to express this,
    // which is why the by-id path is a second entry point.
    expect(translate({ terms: ['1706.03762'], phrases: [], join: 'AND' })).toContain('ti:');
  });

  it('reads one record, because the id identifies it', async () => {
    get.mockResolvedValue(ok(FEED));

    await fetchRecord('1706.03762', options);

    expect(get.mock.calls[0]![1].params.max_results).toBe(1);
  });
});

describe('lookup', () => {
  it('normalises the entry into a Paper', async () => {
    get.mockResolvedValue(ok(FEED));

    const paper = await lookup('1706.03762', options);

    expect(paper?.title).toBe('Attention Is All You Need');
  });

  it('keeps the version arXiv answers with, which is what nativeId carries', async () => {
    // `id_list=1706.03762` comes back as `…/abs/1706.03762v7`, and `normalize`
    // keeps the suffix. `lookupPaper` compares that against the id it asked
    // about, so a search result — which carries the versioned id — round-trips.
    get.mockResolvedValue(ok(FEED));

    const paper = await lookup('1706.03762v7', options);

    expect(paper?.id).toBe('arxiv:1706.03762v7');
    expect(paper?.sources[0]?.nativeId).toBe('1706.03762v7');
  });

  it('answers null for an id nobody has', async () => {
    get.mockResolvedValue(ok(EMPTY));

    expect(await lookup('0000.00000', options)).toBeNull();
  });
});
