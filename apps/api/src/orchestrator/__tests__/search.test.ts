import { describe, it, expect, vi } from 'vitest';
import { search as searchWith, ProviderCache, parseQuery } from '../index';
import type { SearchOptions } from '../index';
import type { ProviderEntry } from '../registry';
import { paper, ref } from './helpers';

/**
 * Every test here drives the pipeline offline, so the authorities are turned
 * off rather than left to their default. Enrichment is real I/O against
 * services that owe us nothing, and none of these tests are about it — they
 * are about plan, merge, rank, filter and pagination, all of which run before
 * it and none of which it can change. `enrich.test.ts` covers the step itself.
 */
const search = (query: Parameters<typeof searchWith>[0], options: SearchOptions = {}) =>
  searchWith(query, { authorities: [], ...options });

function stub(id: any, papers: any[], over: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id,
    capabilities: {
      keywordSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false
    },
    translate: () => `native(${id})`,
    normalizerVersion: 1,
    search: async () => ({ papers, totalHits: papers.length * 10, skipped: [] }),
    ...over
  };
}

const page = (id: any, n: number, titlePrefix = 'CRISPR study') =>
  Array.from({ length: n }, (_, i) =>
    paper({
      id: `${id}:${i}`,
      title: `${titlePrefix} ${i}`,
      doi: `10.1/${id}-${i}`,
      year: 2020 + (i % 3),
      venue: `Journal ${i % 4}`,
      sources: [ref(id, { nativeId: String(i), rank: i })]
    }));

const QUERY = parseQuery('crispr study');

describe('orchestrator search', () => {
  it('returns a page, a total, facets and a report per provider', async () => {
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 30)), stub('ncbi', page('ncbi', 20))],
      pageSize: 10
    });

    expect(result.papers).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.reports.map(r => r.provider).sort()).toEqual(['europepmc', 'ncbi']);
    expect(result.complete).toBe(true);
    expect(Object.keys(result.facets)).toContain('source');
  });

  it('paginates over the filtered set', async () => {
    const providers = [stub('europepmc', page('europepmc', 25))];
    const first = await search(QUERY, { providers, pageSize: 10, page: 1 });
    const second = await search(QUERY, { providers, pageSize: 10, page: 2 });
    const third = await search(QUERY, { providers, pageSize: 10, page: 3 });

    expect([first.papers.length, second.papers.length, third.papers.length]).toEqual([10, 10, 5]);
    const ids = new Set([...first.papers, ...second.papers, ...third.papers].map(p => p.id));
    expect(ids.size).toBe(25);
  });

  it('keeps the reported total stable across pages', async () => {
    // Depth is independent of page on purpose: letting it grow would change
    // the total as the user walks through the results.
    const providers = [stub('europepmc', page('europepmc', 25))];
    const totals = await Promise.all(
      [1, 2, 3].map(async p => (await search(QUERY, { providers, pageSize: 10, page: p })).total)
    );
    expect(new Set(totals).size).toBe(1);
  });

  it('does not return results in contiguous provider blocks', async () => {
    // The measured failure: 13 blocks, because ordering was "group by source".
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 15)), stub('ncbi', page('ncbi', 15))],
      pageSize: 30
    });

    const sequence = result.papers.map(p => p.sources[0].provider);
    const runs = sequence.filter((p, i) => i === 0 || p !== sequence[i - 1]).length;
    expect(runs).toBeGreaterThan(2);
  });

  it('marks the result incomplete when a provider fails', async () => {
    const failing = stub('ncbi', [], { search: async () => { throw new Error('upstream 503'); } });
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 5)), failing]
    });

    expect(result.complete).toBe(false);
    expect(result.reports.find(r => r.provider === 'ncbi')).toMatchObject({ status: 'error' });
    // The total is still returned, but it is a lower bound.
    expect(result.total).toBe(5);
  });

  it('merges across providers and surfaces the merged-in abstract', async () => {
    const withoutAbstract = paper({
      id: 'e', doi: '10.1/shared', abstract: undefined, sources: [ref('europepmc', { rank: 0 })]
    });
    const withAbstract = paper({
      id: 'n', doi: '10.1/shared', abstract: 'Only NCBI had this', sources: [ref('ncbi', { rank: 0 })]
    });

    const result = await search(QUERY, {
      providers: [stub('europepmc', [withoutAbstract]), stub('ncbi', [withAbstract])]
    });

    expect(result.total).toBe(1);
    expect(result.papers[0].abstract).toBe('Only NCBI had this');
    expect(result.papers[0].fieldSources.abstract).toBe('ncbi');
    expect(result.papers[0].sources.map(s => s.provider)).toEqual(['europepmc', 'ncbi']);
  });

  it('filters by oaStatus, which changes the result set', async () => {
    const papers = [
      paper({ id: 'g', doi: '10.1/g', oaStatus: 'gold', sources: [ref('europepmc', { rank: 0 })] }),
      paper({ id: 'b', doi: '10.1/b', oaStatus: 'bronze', sources: [ref('europepmc', { rank: 1 })] })
    ];
    const providers = [stub('europepmc', papers)];

    expect((await search(QUERY, { providers })).total).toBe(2);
    expect((await search(QUERY, { providers, filters: { oaStatus: ['gold'] } })).total).toBe(1);
  });

  it('counts facets over the filtered set, so buckets reconcile with the total', async () => {
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 12))],
      pageSize: 5,
      filters: { yearFrom: 2021 }
    });

    const venueTotal = result.facets.venue.reduce((t, b) => t + b.count, 0);
    expect(venueTotal).toBe(result.total);
    expect(result.total).toBeLessThan(12);
  });

  it('serves a second search from the provider cache', async () => {
    const upstream = vi.fn(async () => ({ papers: page('europepmc', 10), totalHits: 100, skipped: [] }));
    const providers = [stub('europepmc', [], { search: upstream })];
    const cache = new ProviderCache();

    await search(QUERY, { providers, cache, pageSize: 10, page: 1 });
    await search(QUERY, { providers, cache, pageSize: 10, page: 2 });
    await search(QUERY, { providers, cache, pageSize: 10, page: 1, filters: { yearFrom: 2021 } });

    // Page, and a post-fetch filter, cost nothing upstream.
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent identical searches onto one fan-out', async () => {
    const upstream = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 20));
      return { papers: page('europepmc', 5), skipped: [] };
    });
    const providers = [stub('europepmc', [], { search: upstream })];
    const cache = new ProviderCache();

    await Promise.all(Array.from({ length: 4 }, () => search(QUERY, { providers, cache })));

    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('skips a provider that cannot serve the query and says so', async () => {
    // DataCite stands in for a provider that cannot take a keyword query. It
    // was `opencitations`, which is an authority and never appears in a
    // fan-out at all — the capabilities below are the stub's anyway, so the id
    // only ever had to be a real provider.
    const doiOnly = stub('datacite', [], {
      capabilities: {
        keywordSearch: false, doiLookup: true, fields: [], yearFilter: false,
        maxPageSize: 100, reportsTotal: false, suppliesCitations: true
      }
    });
    const result = await search(QUERY, { providers: [stub('europepmc', page('europepmc', 3)), doiOnly] });

    const skipped = result.reports.find(r => r.provider === 'datacite');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.skipReason).toMatch(/keywordSearch/);
    // A deliberate skip does not make the result incomplete.
    expect(result.complete).toBe(true);
  });

  it('returns an empty page rather than throwing when nothing matches', async () => {
    const result = await search(QUERY, { providers: [stub('europepmc', [])] });
    expect(result.papers).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.complete).toBe(true);
  });
});

/**
 * Phase 09's four acceptance criteria, asserted against the pipeline rather
 * than against the enricher on its own. Three of them are properties of the
 * whole path — where enrichment runs, what a DOI query returns, and whether a
 * sort has anything to order on — and could each pass in a unit test while
 * failing here.
 */
describe('orchestrator search — authorities and enrichment', () => {
  const authority = (id: any, facts: any, over: any = {}) => ({
    id,
    capabilities: { fields: Object.keys(facts ?? {}), authoritative: [] as any[] },
    pass: 0 as const,
    lookup: async () => facts,
    ...over
  });

  it('asks about the page and not the set', async () => {
    // The reason enrichment is last. A measured result set of 2,388 records
    // would be 2,388 requests per authority; a page of twenty is twenty.
    const lookups = vi.fn(async () => ({ publisher: 'Springer' }));
    const result = await searchWith(QUERY, {
      providers: [stub('europepmc', page('europepmc', 200))],
      pageSize: 20,
      authorities: [authority('crossref', null, { lookup: lookups })]
    });

    expect(result.total).toBe(200);
    expect(lookups).toHaveBeenCalledTimes(20);
    expect(result.authorities[0]).toMatchObject({ authority: 'crossref', asked: 20 });
  });

  it('carries fieldSources naming another provider for two fields on a paper', async () => {
    const result = await searchWith(QUERY, {
      providers: [stub('europepmc', page('europepmc', 3))],
      authorities: [
        authority('crossref', { publisher: 'Springer', abstract: 'On CRISPR.' }),
        authority('unpaywall', {
          fullText: { url: 'https://repo.example.org/a.pdf', kind: 'pdf', verified: false }
        }, { capabilities: { fields: ['fullText'], authoritative: ['fullText'] } })
      ]
    });

    const attributed = result.papers.filter(p => Object.keys(p.fieldSources).length >= 2);
    expect(attributed.length).toBeGreaterThan(0);
    expect(attributed[0].fieldSources).toMatchObject({ publisher: 'crossref', abstract: 'crossref' });
    // And the provider that found the paper is not the one that described it.
    expect(attributed[0].sources[0].provider).toBe('europepmc');
  });

  it('answers a DOI query with one paper', async () => {
    // The old path's OpenAlex lookup was `search=doi:…`, a full-text search for
    // the literal string, so it could return a topically similar paper that
    // then merged in beside the right one as its peer. `filter=doi:…` matches
    // exactly one — asserted against the response in the provider's tests; what
    // this asserts is that three providers answering about the same DOI
    // collapse to a single paper rather than three.
    const doi = '10.1038/srep09811';
    const found = (id: any) => [paper({
      id: `${id}:1`,
      doi,
      title: 'Rapid generation of endogenously driven transcriptional reporters',
      sources: [ref(id, { nativeId: '1', rank: 0 })]
    })];

    const result = await searchWith(parseQuery(doi), {
      providers: [stub('openalex', found('openalex')), stub('crossref', found('crossref')), stub('core', found('core'))],
      authorities: []
    });

    expect(result.total).toBe(1);
    expect(result.papers[0].sources.map(s => s.provider).sort()).toEqual(['core', 'crossref', 'openalex']);
  });

  it('reorders results when sorted by citations', async () => {
    const cited = (id: string, count: number | undefined, i: number) => paper({
      id, doi: `10.1/${id}`, title: `Study ${i}`,
      ...(count !== undefined ? { citationCount: count } : {}),
      sources: [ref('europepmc', { nativeId: id, rank: i })]
    });

    const providers = [stub('europepmc', [
      cited('a', 5, 0), cited('b', 900, 1), cited('c', undefined, 2), cited('d', 40, 3)
    ])];

    const relevance = await searchWith(QUERY, { providers, authorities: [] });
    const citations = await searchWith(QUERY, { providers, sort: 'citations', authorities: [] });

    expect(citations.papers.map(p => p.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(citations.papers.map(p => p.id)).not.toEqual(relevance.papers.map(p => p.id));
  });

  it('backfills a citation count the providers did not supply', async () => {
    const uncited = paper({ id: 'a', doi: '10.1/a', sources: [ref('europepmc')] });

    const result = await searchWith(QUERY, {
      providers: [stub('europepmc', [uncited])],
      authorities: [authority('opencitations', { citationCount: 43 }, {
        capabilities: { fields: ['citationCount'], authoritative: [] },
        pass: 1,
        wants: (p: any) => p.citationCount === undefined
      })]
    });

    expect(result.papers[0].citationCount).toBe(43);
    expect(result.papers[0].fieldSources.citationCount).toBe('opencitations');
  });

  it('returns the page unchanged when every authority fails', async () => {
    const result = await searchWith(QUERY, {
      providers: [stub('europepmc', page('europepmc', 5))],
      authorities: [authority('crossref', null, {
        capabilities: { fields: ['publisher'], authoritative: [] },
        lookup: async () => { throw new Error('Crossref 503'); }
      })]
    });

    expect(result.papers).toHaveLength(5);
    expect(result.authorities[0].status).toBe('error');
    // The result set is whole without enrichment; only the detail is missing.
    expect(result.complete).toBe(true);
  });
});

/**
 * The API is stateless in the sense that matters: one request cannot change
 * what another gets back.
 *
 * Two in-process caches survive phase 10 by design — the provider cache here
 * and the cache manager's L1 — so "no in-process mutable state in the request
 * path" cannot mean "no state at all". It means no state whose mutation
 * changes an answer. The cache manager holds serialised values and parses on
 * read, so it hands out a fresh object by construction. The provider cache
 * holds live `Paper` objects and hands out the same ones to every caller,
 * which is cheap and safe only while nothing downstream writes to them.
 *
 * Enrichment is the one step that writes to a paper, and it copies first. That
 * is an invariant of the whole pipeline rather than a property of one
 * function, so it is asserted here, through the cache, rather than trusted.
 */
describe('orchestrator search — statelessness', () => {
  it('does not let one request alter what the next one gets from the cache', async () => {
    const cached = paper({
      id: 'europepmc:1',
      doi: '10.1/a',
      topics: ['crispr'],
      sources: [ref('europepmc', { nativeId: '1', rank: 0 })]
    });

    const providers = [stub('europepmc', [cached])];
    const cache = new ProviderCache();

    const enricher = {
      id: 'crossref' as any,
      capabilities: { fields: ['publisher', 'topics', 'abstract'] as any, authoritative: [] as any[] },
      pass: 0 as const,
      lookup: async () => ({ publisher: 'Springer', topics: ['genetics'], abstract: 'On CRISPR.' })
    };

    const first = await searchWith(QUERY, { providers, cache, authorities: [enricher] });
    expect(first.papers[0]).toMatchObject({ publisher: 'Springer', topics: ['crispr', 'genetics'] });

    // Served from the provider cache this time — the stub is never called
    // again — so anything the first request wrote through would show up here.
    const second = await searchWith(QUERY, { providers, cache, authorities: [] });

    expect(second.papers[0].publisher).toBeUndefined();
    expect(second.papers[0].topics).toEqual(['crispr']);
    expect(second.papers[0].abstract).toBeUndefined();
    expect(second.papers[0].fieldSources).toEqual({});
  });
});

/**
 * The gap: `applyPolicy` runs before pagination and drops a paper with no
 * retrievable copy, and enrichment — the only thing that could have found one
 * — ran on a page that paper never reached. It was absent from `total`, from
 * the facets, and from anything in the response that could have said so.
 */
describe('the rescue pass', () => {
  const PDF = { url: 'https://example.org/rescued.pdf', kind: 'pdf' as const, verified: false };

  const rescuer = (lookup: () => Promise<any>) => ({
    id: 'unpaywall' as any,
    capabilities: {
      fields: ['fullText', 'oaStatus'] as any,
      authoritative: ['fullText', 'oaStatus'] as any
    },
    pass: 0 as const,
    lookup
  });

  // Ranked first — it is the top hit for this query — and dropped anyway,
  // because Europe PMC advertised no copy for it.
  const withoutCopy = paper({
    id: 'europepmc:not',
    doi: '10.1/not',
    title: 'CRISPR study',
    fullText: undefined,
    sources: [ref('europepmc', { nativeId: 'not', rank: 0 })]
  });

  const withCopy = paper({
    id: 'europepmc:has',
    doi: '10.1/has',
    title: 'CRISPR study',
    sources: [ref('europepmc', { nativeId: 'has', rank: 1 })]
  });

  const providers = () => [stub('europepmc', [withoutCopy, withCopy])];

  it('drops the paper when there is nobody to ask, as it always did', async () => {
    const result = await search(QUERY, { providers: providers() });

    expect(result.total).toBe(1);
    expect(result.papers.map(p => p.id)).toEqual(['europepmc:has']);
    expect(result.rescue).toMatchObject({ candidates: 1, examined: 0, rescued: 0 });
  });

  it('returns it once an authority finds a copy', async () => {
    const result = await searchWith(QUERY, {
      providers: providers(),
      authorities: [rescuer(async () => ({ fullText: PDF }))]
    });

    expect(result.total).toBe(2);
    expect(result.papers.map(p => p.id)).toContain('europepmc:not');
    expect(result.rescue).toMatchObject({ candidates: 1, examined: 1, rescued: 1, bounded: false });
  });

  it('counts it in the facets, so a bucket still says what selecting it yields', async () => {
    const result = await searchWith(QUERY, {
      providers: providers(),
      authorities: [rescuer(async () => ({ fullText: PDF }))]
    });

    expect(result.facets.source.find(b => b.value === 'europepmc')?.count).toBe(2);
    expect(result.facets.source.find(b => b.value === 'europepmc')?.count).toBe(result.total);
  });

  it('puts it back at the rank it always had, not at the end', async () => {
    // It was ranked with everything else and only ever excluded by the gate,
    // so being rescued restores a position rather than granting a new one.
    const result = await searchWith(QUERY, {
      providers: providers(),
      authorities: [rescuer(async () => ({ fullText: PDF }))]
    });

    expect(result.papers.map(p => p.id)).toEqual(['europepmc:not', 'europepmc:has']);
  });

  it('asks about a rescued paper once, not again when it lands on the page', async () => {
    const lookup = vi.fn(async () => ({ fullText: PDF }));

    await searchWith(QUERY, { providers: providers(), authorities: [rescuer(lookup)] });

    const asked = lookup.mock.calls.map(([args]: any) => args.doi);

    // The rescued paper is asked about by the rescue and then lands on the
    // page the enrichment runs over. Without the shared AuthorityCache that is
    // two identical requests to Unpaywall inside one search.
    expect(asked.filter((doi: string) => doi === '10.1/not')).toHaveLength(1);
    // The other paper was never a candidate, so the page is the first time
    // anyone asks about it. That request is not a duplicate of anything.
    expect(asked.filter((doi: string) => doi === '10.1/has')).toHaveLength(1);
  });

  it('leaves the set alone when the authority has no copy either', async () => {
    const result = await searchWith(QUERY, {
      providers: providers(),
      authorities: [rescuer(async () => null)]
    });

    expect(result.total).toBe(1);
    expect(result.rescue).toMatchObject({ examined: 1, rescued: 0 });
  });

  it('says so when the limit left candidates unasked', async () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      paper({
        id: `europepmc:${i}`,
        doi: `10.1/${i}`,
        title: 'CRISPR study',
        fullText: undefined,
        sources: [ref('europepmc', { nativeId: String(i), rank: i })]
      }));

    const result = await searchWith(QUERY, {
      providers: [stub('europepmc', many)],
      authorities: [rescuer(async () => ({ fullText: PDF }))],
      rescueLimit: 2
    });

    expect(result.total).toBe(2);
    expect(result.rescue).toMatchObject({ candidates: 4, examined: 2, rescued: 2, bounded: true });
  });

  it('can be turned off, which restores the old set exactly', async () => {
    const result = await searchWith(QUERY, {
      providers: providers(),
      authorities: [rescuer(async () => ({ fullText: PDF }))],
      rescueLimit: 0
    });

    expect(result.total).toBe(1);
    expect(result.rescue).toMatchObject({ candidates: 1, examined: 0, rescued: 0 });
  });
});

describe('facets after a filter is ticked', () => {
  // The end-to-end half of `facet.test.ts`: through plan, merge, rank, the
  // policy partition and the rescue, which is where `admitted` comes from.
  const corpus = [
    paper({ id: 'a', title: 'A', doi: '10.1/a', year: 2021, venue: 'Nature',
            sources: [ref('europepmc', { nativeId: 'a', rank: 0 })] }),
    paper({ id: 'b', title: 'B', doi: '10.1/b', year: 2022, venue: 'Science',
            sources: [ref('europepmc', { nativeId: 'b', rank: 1 })] }),
    paper({ id: 'c', title: 'C', doi: '10.1/c', year: 2023, venue: 'Cell',
            sources: [ref('europepmc', { nativeId: 'c', rank: 2 })] })
  ];

  const providers = [stub('europepmc', corpus)];

  it('leaves the unticked years selectable', async () => {
    const result = await search(QUERY, { providers, filters: { year: ['2022'] } });

    expect(result.total).toBe(1);
    expect(result.papers.map(p => p.id)).toEqual(['b']);
    // The whole point: 2021 and 2023 are still in the panel to be added.
    expect(result.facets.year.map(b => b.value).sort()).toEqual([2021, 2022, 2023]);
  });

  it('leaves the unticked venues selectable', async () => {
    const result = await search(QUERY, { providers, filters: { venue: ['Nature'] } });

    expect(result.total).toBe(1);
    expect(result.facets.venue.map(b => b.value).sort()).toEqual(['Cell', 'Nature', 'Science']);
  });

  it('returns the union when a second value is added', async () => {
    const result = await search(QUERY, { providers, filters: { year: ['2021', '2023'] } });

    expect(result.total).toBe(2);
    expect(result.papers.map(p => p.id).sort()).toEqual(['a', 'c']);
  });
});
