import { describe, it, expect, vi, beforeEach } from 'vitest';

const { links, works } = vi.hoisted(() => ({ links: vi.fn(), works: vi.fn() }));
vi.mock('../graph/opencitations', async importOriginal => ({
  ...(await importOriginal<typeof import('../graph/opencitations')>()),
  citationLinks: links
}));
vi.mock('../providers/openalex/fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('../providers/openalex/fetch')>()),
  fetchWorksByDoi: works
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

  it('asks nothing for no DOIs', async () => {
    const engine = createEngine({ userAgent: 'test', providers: [], authorities: [] });
    expect(await engine.resolveDois([])).toEqual({ found: new Map(), unasked: [] });
    expect(works).not.toHaveBeenCalled();
  });
});
