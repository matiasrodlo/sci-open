import { describe, it, expect, vi, beforeEach } from 'vitest';

const { links, works } = vi.hoisted(() => ({ links: vi.fn(), works: vi.fn() }));
vi.mock('../graph/opencitations', () => ({ citationLinks: links }));
vi.mock('../providers/openalex/fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('../providers/openalex/fetch')>()),
  fetchWorksByDoi: works
}));

import { createEngine } from '../engine';
import { OpenAlexUnavailableError } from '../providers/openalex/fetch';
import type { ProviderEntry } from '../orchestrator/registry';

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
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 200, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: query => query.terms.join(' '),
    normalizerVersion: 1,
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

  it('holds nothing that failed', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    links.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([]);
    await expect(engine.citationLinks('10.1/x', 'cited_by')).rejects.toThrow('down');
    expect(await engine.citationLinks('10.1/x', 'cited_by')).toEqual([]);
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

  it('asks nothing for no DOIs', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    expect(await engine.resolveDois([])).toEqual({ found: new Map(), unasked: [] });
    expect(works).not.toHaveBeenCalled();
  });
});
