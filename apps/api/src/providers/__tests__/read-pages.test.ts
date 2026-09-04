import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readPages } from '../read-pages';

/**
 * The shared half of the fix for the `maxPageSize` shortfall: `fanOut` asks a
 * provider once for `depth` records, and a provider whose page is smaller than
 * `depth` used to answer with one page and have it recorded as a complete read.
 */

type Payload = { items: string[]; total?: number };

const record = (n: number) => `r${n}`;

/** A corpus of `size` records, served `perPage` at a time. */
const corpus = (size: number, options: { reportsTotal?: boolean } = {}) => {
  const { reportsTotal = true } = options;
  return vi.fn(async ({ pageSize, offset }: { pageSize: number; offset: number }): Promise<Payload> => ({
    items: Array.from(
      { length: Math.max(Math.min(pageSize, size - offset), 0) },
      (_, i) => record(offset + i)
    ),
    ...(reportsTotal ? { total: size } : {})
  }));
};

const read = (fetch: ReturnType<typeof corpus>, wanted: number, perPage: number, offset = 0) =>
  readPages<Payload, string>({
    wanted,
    perPage,
    offset,
    fetch,
    itemsOf: payload => payload.items,
    totalOf: payload => payload.total
  });

let fetch: ReturnType<typeof corpus>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('filling the requested depth', () => {
  it('reads across the page cap rather than stopping at one page', async () => {
    // The defect: 600 asked for, 100 served, reported as ok.
    fetch = corpus(5000);

    const { items, requests } = await read(fetch, 600, 100);

    expect(items).toHaveLength(600);
    expect(requests).toBe(6);
  });

  it('returns the records in page order, so ranks stay contiguous', async () => {
    // `rankOffset` is applied to the concatenated list, and `SourceRef.rank`
    // feeds rank fusion — an order that interleaves pages would scramble it.
    fetch = corpus(5000);

    const { items } = await read(fetch, 250, 100);

    expect(items.slice(0, 3)).toEqual(['r0', 'r1', 'r2']);
    expect(items[100]).toBe('r100');
    expect(items[200]).toBe('r200');
    expect(items).toHaveLength(250);
  });

  it('asks each page for its own offset', async () => {
    fetch = corpus(5000);

    await read(fetch, 300, 100);

    expect(fetch.mock.calls.map(([args]) => args.offset)).toEqual([0, 100, 200]);
  });

  it('starts from a non-zero offset', async () => {
    fetch = corpus(5000);

    await read(fetch, 200, 100, 400);

    expect(fetch.mock.calls.map(([args]) => args.offset)).toEqual([400, 500]);
  });
});

describe('not paying for pages that are not there', () => {
  it('costs one request when the corpus fits in a page', async () => {
    // The reason this reads the first page before deciding, rather than issuing
    // every page blind: a 40-hit query would otherwise cost six requests, five
    // of them answered empty.
    fetch = corpus(40);

    const { items, requests } = await read(fetch, 600, 100);

    expect(items).toHaveLength(40);
    expect(requests).toBe(1);
  });

  it('reads only the pages the reported total says exist', async () => {
    fetch = corpus(250);

    const { items, requests } = await read(fetch, 600, 100);

    expect(items).toHaveLength(250);
    expect(requests).toBe(3);
  });

  it('costs one request when the caller wanted no more than a page', async () => {
    fetch = corpus(5000);

    const { requests } = await read(fetch, 100, 100);

    expect(requests).toBe(1);
  });

  it('stops at a short page even when the total disagrees', async () => {
    // A provider that returns fewer records than asked for has no more to give,
    // whatever it claimed its total was. Trusting the count over the page is
    // how a read spends requests on nothing.
    const overclaiming = vi.fn(async ({ offset }: { pageSize: number; offset: number }) => ({
      items: offset === 0 ? Array.from({ length: 40 }, (_, i) => record(i)) : [],
      total: 100_000
    }));

    const { items, requests } = await readPages<Payload, string>({
      wanted: 600,
      perPage: 100,
      offset: 0,
      fetch: overclaiming,
      itemsOf: p => p.items,
      totalOf: p => p.total
    });

    expect(items).toHaveLength(40);
    expect(requests).toBe(1);
  });

  it('falls back to the requested depth when no total is reported', async () => {
    fetch = corpus(5000, { reportsTotal: false });

    const { items, total, requests } = await read(fetch, 300, 100);

    expect(items).toHaveLength(300);
    expect(requests).toBe(3);
    expect(total).toBeUndefined();
  });
});

describe('exactLastPage', () => {
  it('asks the closing request for only what is still wanted', async () => {
    // NCBI addresses records by `retstart`, so a short final request lands
    // where the arithmetic intends. At depth 600 against a 500-record page,
    // a full second page would fetch 1,000 abstracts to return 600.
    const fetch = corpus(5000);

    const { items } = await readPages<Payload, string>({
      wanted: 600,
      perPage: 500,
      offset: 0,
      exactLastPage: true,
      fetch,
      itemsOf: p => p.items,
      totalOf: p => p.total
    });

    expect(fetch.mock.calls.map(([a]) => a.pageSize)).toEqual([500, 100]);
    expect(fetch.mock.calls.map(([a]) => a.offset)).toEqual([0, 500]);
    expect(items).toHaveLength(600);
  });

  it('still asks for full pages in the middle of a read', async () => {
    const fetch = corpus(5000);

    await readPages<Payload, string>({
      wanted: 250,
      perPage: 100,
      offset: 0,
      exactLastPage: true,
      fetch,
      itemsOf: p => p.items,
      totalOf: p => p.total
    });

    expect(fetch.mock.calls.map(([a]) => a.pageSize)).toEqual([100, 100, 50]);
  });

  it('is off by default, because a page-numbered API cannot take a short page', async () => {
    // DOAJ and OpenAIRE derive their page number from `offset / pageSize`, so
    // a request sized differently from its neighbours lands on the wrong page.
    const fetch = corpus(5000);

    await read(fetch, 600, 500);

    expect(fetch.mock.calls.map(([a]) => a.pageSize)).toEqual([500, 500]);
  });
});

describe('reporting', () => {
  it('carries the corpus-wide total through', async () => {
    fetch = corpus(5000);

    expect((await read(fetch, 600, 100)).total).toBe(5000);
  });

  it('fails the whole read when a page fails', async () => {
    // Deliberate, and the same rule OpenAlex states: `ProviderReport` has no
    // way to say "short by 400", so returning the pages that did succeed would
    // report a partial read as a complete one — the silent shortfall this
    // module exists to remove, by another route. The orchestrator marks the
    // search incomplete instead.
    const flaky = vi.fn(async ({ offset }: { pageSize: number; offset: number }) => {
      if (offset === 200) throw new Error('upstream 503');
      return { items: Array.from({ length: 100 }, (_, i) => record(offset + i)), total: 5000 };
    });

    await expect(
      readPages<Payload, string>({
        wanted: 600,
        perPage: 100,
        offset: 0,
        fetch: flaky,
        itemsOf: p => p.items,
        totalOf: p => p.total
      })
    ).rejects.toThrow('upstream 503');
  });
});

describe('degenerate inputs', () => {
  it('treats a wanted of zero as one record rather than dividing by it', async () => {
    fetch = corpus(5000);

    const { items, requests } = await read(fetch, 0, 100);

    expect(items).toHaveLength(1);
    expect(requests).toBe(1);
  });

  it('survives a perPage of zero rather than looping forever', async () => {
    fetch = corpus(5000);

    const { requests } = await read(fetch, 10, 0);

    expect(requests).toBeGreaterThan(0);
    expect(fetch.mock.calls[0]![0].pageSize).toBe(1);
  });
});
