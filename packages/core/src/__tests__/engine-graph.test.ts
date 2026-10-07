import { describe, it, expect, vi, beforeEach } from 'vitest';

const { links, works, crossrefPage } = vi.hoisted(() => ({ links: vi.fn(), works: vi.fn(), crossrefPage: vi.fn() }));
vi.mock('../graph/opencitations', async importOriginal => ({
  ...(await importOriginal<typeof import('../graph/opencitations')>()),
  citationLinks: links
}));
vi.mock('../providers/openalex/fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('../providers/openalex/fetch')>()),
  fetchWorksByDoi: works
}));
vi.mock('../providers/crossref/fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('../providers/crossref/fetch')>()),
  fetchPage: crossrefPage
}));

import type { Paper } from '@sci-open/shared';
import { createEngine } from '../engine';
import { OpenAlexUnavailableError } from '../providers/openalex/fetch';
import { OpenCitationsUnavailableError } from '../graph/opencitations';
import { SourceBusyError } from '../lib/host-pacer';
import type { ProviderEntry } from '../orchestrator/registry';
import type { AuthorityEntry } from '../authorities';
import { paper, ref } from '../orchestrator/__tests__/helpers';

/**
 * The engine's two graph methods, with OpenCitations and OpenAlex stubbed at
 * the module boundary: what is held, what is asked, and what a refusal
 * leaves out afterwards.
 */

const work = (doi: string, title = `Work ${doi}`) => ({
  id: `https://openalex.org/W${doi.replace(/\D/g, '')}`,
  doi: `https://doi.org/${doi}`,
  title,
  display_name: title,
  publication_year: 2021,
  authorships: [{ author: { display_name: 'Ada Lovelace' } }]
});

/** OpenAlex as a search source, recording whether it was asked. */
function openalexSource() {
  const asked: string[] = [];
  const entry: ProviderEntry = {
    id: 'openalex',
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true,
      maxPageSize: 200, reportsTotal: true,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: query => query.terms.join(' '),
    search: async ({ query }) => {
      asked.push(query.terms.join(' '));
      return { papers: [], totalHits: 0, skipped: [] };
    }
  };
  return { entry, asked };
}

beforeEach(() => {
  links.mockReset();
  works.mockReset();
  crossrefPage.mockReset();
});

/** Crossref as a search source, recording whether it was searched. */
function crossrefSource() {
  const source = openalexSource();
  return { entry: { ...source.entry, id: 'crossref' as const }, asked: source.asked };
}

/** Crossref's answer to a `doi:` filter: a record for each DOI asked, as `fetchPage` returns it. */
const crossrefAnswer = (native: string) => ({
  message: {
    items: new URLSearchParams(native).get('filter')!.split(',').map(f => f.slice('doi:'.length))
      .map(doi => ({ DOI: doi, title: [`Work ${doi}`], subtitle: ['its subtitle'], issued: { 'date-parts': [[2020]] }, type: 'journal-article' }))
  }
});

describe('citationLinks', () => {
  it('fetches a list once however it is paged, for ten minutes, per direction', async () => {
    let t = 0;
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [], now: () => t, openCitationsToken: 'tok' });
    links.mockResolvedValue([{ dois: ['10.1/a'], journalSelfCitation: false, authorSelfCitation: false }]);

    await engine.citationLinks('10.7717/PEERJ-CS.421', 'cited_by');
    await engine.citationLinks('https://doi.org/10.7717/peerj-cs.421', 'cited_by');
    expect(links).toHaveBeenCalledTimes(1);
    expect(links.mock.calls[0]![2]).toMatchObject({ userAgent: 'test', token: 'tok' });

    await engine.citationLinks('10.7717/peerj-cs.421', 'references');
    expect(links).toHaveBeenCalledTimes(2);

    t = 10 * 60_000 + 1;
    await engine.citationLinks('10.7717/peerj-cs.421', 'cited_by');
    expect(links).toHaveBeenCalledTimes(3);
  });

  it('asks once for two pages wanted at the same moment', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    links.mockImplementation(async () => [{ dois: [], journalSelfCitation: false, authorSelfCitation: false }]);
    await Promise.all([engine.citationLinks('10.1/x', 'cited_by'), engine.citationLinks('10.1/x', 'cited_by')]);
    expect(links).toHaveBeenCalledTimes(1);
  });

  it('stops fetching a list its only reader left, and holds nothing', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    links.mockImplementationOnce((_doi: string, _direction: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
    const reader = new AbortController();

    const reading = engine.citationLinks('10.1/x', 'cited_by', { signal: reader.signal });
    reader.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect((links.mock.calls[0]![2] as { signal: AbortSignal }).signal.aborted).toBe(true);

    links.mockResolvedValueOnce([]);
    expect(await engine.citationLinks('10.1/x', 'cited_by')).toEqual([]);
    expect(links).toHaveBeenCalledTimes(2);
  });

  it('holds nothing that failed', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    links.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([]);
    await expect(engine.citationLinks('10.1/x', 'cited_by')).rejects.toThrow('down');
    expect(await engine.citationLinks('10.1/x', 'cited_by')).toEqual([]);
  });
});

describe('OpenCitations’ allowance', () => {
  const none = [{ dois: [], journalSelfCitation: false, authorSelfCitation: false }];

  it('sends at most the minute’s allowance, says when the next may go, and spends none on a held list', async () => {
    let t = 0;
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [], now: () => t, openCitationsPerMinute: 2 });
    links.mockResolvedValue(none);

    await engine.citationLinks('10.1234/a', 'cited_by');
    t = 20_000;
    await engine.citationLinks('10.1234/b', 'cited_by');
    await engine.citationLinks('10.1234/a', 'cited_by'); // held: free
    const refused = await engine.citationLinks('10.1234/c', 'cited_by').catch(e => e);
    expect(refused).toBeInstanceOf(SourceBusyError);
    expect(refused).toMatchObject({ host: 'api.opencitations.net', retryAfterMs: 40_000 });
    expect(links).toHaveBeenCalledTimes(2);

    t = 60_001; // the first send has left the window
    await engine.citationLinks('10.1234/c', 'cited_by');
    expect(links).toHaveBeenCalledTimes(3);
  });

  it('leaves OpenCitations alone after a 429, for as long as it asks, then asks again', async () => {
    let t = 0;
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [], now: () => t });
    links.mockRejectedValueOnce(new OpenCitationsUnavailableError(429, 'Too Many Requests', 30)).mockResolvedValue(none);

    await expect(engine.citationLinks('10.1234/a', 'cited_by')).rejects.toMatchObject({ retryAfterMs: 30_000 });
    t = 10_000;
    await expect(engine.citationLinks('10.1234/b', 'references')).rejects.toMatchObject({ retryAfterMs: 20_000 });
    expect(links).toHaveBeenCalledTimes(1);

    t = 30_001;
    expect(await engine.citationLinks('10.1234/b', 'references')).toEqual(none);
    expect(links).toHaveBeenCalledTimes(2);
  });

  it('cools down a minute when the 429 says nothing, and benches the citation-count authority with it', async () => {
    let t = 0;
    const asked: string[] = [];
    const counts: AuthorityEntry = {
      id: 'opencitations',
      capabilities: { fields: ['citationCount'], authoritative: [] },
      pass: 1,
      lookup: async ({ doi }) => {
        asked.push(doi);
        return { citationCount: 7 };
      }
    } as AuthorityEntry;
    const uncounted: Paper = paper({ id: 'europepmc:1', doi: '10.1234/x', sources: [ref('europepmc', { nativeId: '1' })] });
    const source: ProviderEntry = {
      ...openalexSource().entry,
      id: 'europepmc',
      search: async () => ({ papers: [uncounted], totalHits: 1, skipped: [] }),
      lookup: async () => uncounted
    };
    const engine = createEngine({ userAgent: 'test', providers: [source], authorities: [counts], now: () => t });
    links.mockRejectedValueOnce(new OpenCitationsUnavailableError(429, 'Too Many Requests'));

    await expect(engine.citationLinks('10.1234/a', 'cited_by')).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(await engine.lookup('europepmc:1')).not.toHaveProperty('citationCount');
    expect(asked).toEqual([]);

    t = 60_001;
    expect(await engine.lookup('europepmc:1')).toMatchObject({ citationCount: 7 });
    expect(asked).toEqual(['10.1234/x']);
  });
});

describe('resolveDois', () => {
  it('resolves fifty DOIs to a request, keyed by the lower-cased DOI', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    const dois = Array.from({ length: 60 }, (_, i) => `10.1/A${i}`);
    works.mockImplementation(async (batch: string[]) => ({ results: batch.map(d => work(d)) }));

    const { found, unasked } = await engine.resolveDois([...dois, 'https://doi.org/10.1/a0']);

    expect(works.mock.calls.map(([batch]) => (batch as string[]).length)).toEqual([50, 10]);
    expect(found.size).toBe(60);
    expect(found.get('10.1/a0')).toMatchObject({ doi: '10.1/a0', title: 'Work 10.1/a0', year: 2021 });
    expect(unasked).toEqual([]);
  });

  it('says which DOIs it could not ask about, and keeps what the other batches found', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    const dois = Array.from({ length: 60 }, (_, i) => `10.1/${i}`);
    works
      .mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))
      .mockImplementationOnce(async (batch: string[]) => ({ results: batch.map(d => work(d)) }));

    const { found, unasked } = await engine.resolveDois([...dois, '10.1/a|b']);

    expect(unasked).toEqual(['10.1/a|b', ...dois.slice(0, 50)]);
    expect([...found.keys()]).toEqual(dois.slice(50));
  });

  it('cools OpenAlex down on a refused batch, for the batches after it and for searches', async () => {
    const source = openalexSource();
    const engine = createEngine({ userAgent: 'test', providers: [source.entry], authorities: [] });
    works.mockRejectedValue(new OpenAlexUnavailableError(429, 'Insufficient budget.'));

    const first = await engine.resolveDois(Array.from({ length: 60 }, (_, i) => `10.1/${i}`));
    expect(works).toHaveBeenCalledTimes(1);
    expect(first.unasked).toHaveLength(60);

    // Billed against the same budget, so a search leaves the source out too.
    const { response } = await engine.search({ q: 'crispr' });
    expect(source.asked).toEqual([]);
    expect(response.providers.find(r => r.provider === 'openalex')).toMatchObject({ rateLimited: 'cooling-down' });

    await engine.resolveDois(['10.1/x']);
    expect(works).toHaveBeenCalledTimes(1);
  });

  it('asks no batch after its signal aborts, and rejects rather than call the rest unasked', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    const reader = new AbortController();
    works.mockImplementation(async (batch: string[]) => {
      reader.abort(); // the caller gives up while the first batch is out
      return { results: batch.map(d => work(d)) };
    });

    await expect(engine.resolveDois(Array.from({ length: 120 }, (_, i) => `10.1/${i}`), { signal: reader.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(works).toHaveBeenCalledTimes(1);
    expect(works.mock.calls[0]![1]).toMatchObject({ signal: reader.signal });
  });

  it('asks nothing for no DOIs', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    expect(await engine.resolveDois([])).toEqual({ found: new Map(), unasked: [] });
    expect(works).not.toHaveBeenCalled();
  });
});

describe('an engine without OpenAlex', () => {
  it('never asks it: not to search, not about a paper, not for a batch of DOIs', async () => {
    const searched = openalexSource();
    const asked: string[] = [];
    const authority = (id: 'openalex' | 'crossref'): AuthorityEntry => ({
      id,
      capabilities: { fields: ['citationCount'], authoritative: [] },
      pass: 1,
      lookup: async () => {
        asked.push(id);
        return { citationCount: 3 };
      }
    } as AuthorityEntry);
    const held: Paper = paper({ id: 'europepmc:1', doi: '10.1234/x', sources: [ref('europepmc', { nativeId: '1' })] });
    const europepmc: ProviderEntry = {
      ...openalexSource().entry,
      id: 'europepmc',
      search: async () => ({ papers: [held], totalHits: 1, skipped: [] }),
      lookup: async () => held
    };
    const engine = createEngine({
      userAgent: 'test', providers: [searched.entry, europepmc], authorities: [authority('openalex'), authority('crossref')], without: ['openalex']
    });

    const { response } = await engine.search({ q: 'crispr' });
    expect(searched.asked).toEqual([]);
    expect(response.providers.map(r => r.provider)).toEqual(['europepmc']);
    expect(await engine.lookup('europepmc:1')).toMatchObject({ citationCount: 3 });
    expect(asked).toContain('crossref');
    expect(asked).not.toContain('openalex');
    // Unasked, each DOI is left for a lookup in every other source.
    expect(await engine.resolveDois(['10.1/X'])).toEqual({ found: new Map(), unasked: ['10.1/x'] });
    expect(works).not.toHaveBeenCalled();
  });
});

describe('resolveDois from Crossref', () => {
  it('asks Crossref for every DOI, fifty to a request, when OpenAlex is left out', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [crossrefSource().entry], authorities: [], without: ['openalex'] });
    crossrefPage.mockImplementation(async (native: string) => crossrefAnswer(native));
    const dois = Array.from({ length: 60 }, (_, i) => `10.1/A${i}`);

    const { found, unasked } = await engine.resolveDois([...dois, '10.1/a,b']);

    expect(works).not.toHaveBeenCalled();
    expect(crossrefPage.mock.calls.map(([native]) => new URLSearchParams(native as string).get('filter')!.split(',').length)).toEqual([50, 10]);
    expect(found.size).toBe(60);
    expect(found.get('10.1/a0')).toMatchObject({ id: 'crossref:10.1/a0', title: 'Work 10.1/a0: its subtitle', year: 2020 });
    // A comma would split the filter.
    expect(unasked).toEqual(['10.1/a,b']);
  });

  it('asks Crossref about the DOIs OpenAlex failed on, and only those', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [crossrefSource().entry], authorities: [] });
    const dois = Array.from({ length: 60 }, (_, i) => `10.1/${i}`);
    works
      .mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))
      .mockImplementationOnce(async (batch: string[]) => ({ results: batch.map(d => work(d)) }));
    crossrefPage.mockImplementation(async (native: string) => crossrefAnswer(native));

    const { found, unasked } = await engine.resolveDois(dois);

    expect(new URLSearchParams(crossrefPage.mock.calls[0]![0] as string).get('filter')!.split(',')).toEqual(dois.slice(0, 50).map(d => `doi:${d}`));
    expect(found.get('10.1/0')!.id).toBe('crossref:10.1/0');
    expect(found.get('10.1/55')!.id).toMatch(/^openalex:/);
    expect(unasked).toEqual([]);
  });

  it('cools Crossref down on a refused batch, for the batches after it and for searches', async () => {
    const source = crossrefSource();
    const engine = createEngine({ userAgent: 'test', providers: [source.entry], authorities: [], without: ['openalex'] });
    crossrefPage.mockRejectedValue(Object.assign(new Error('Crossref 429'), { status: 429 }));

    const first = await engine.resolveDois(Array.from({ length: 60 }, (_, i) => `10.1/${i}`));
    expect(crossrefPage).toHaveBeenCalledTimes(1);
    expect(first.unasked).toHaveLength(60);

    const { response } = await engine.search({ q: 'crispr', filters: { openAccessOnly: false } });
    expect(source.asked).toEqual([]);
    expect(response.providers.find(r => r.provider === 'crossref')).toMatchObject({ rateLimited: 'cooling-down' });
  });
});
