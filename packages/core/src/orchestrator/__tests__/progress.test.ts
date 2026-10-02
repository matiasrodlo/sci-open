import { describe, it, expect } from 'vitest';
import type { ProviderId } from '@open-access-explorer/shared';
import type { AuthorityEntry } from '../../authorities';
import { runOrchestrator } from '../from-search-params';
import { countSearch } from '../count';
import { ResultSetCache } from '../result-set';
import type { ProviderEntry } from '../registry';
import type { SearchProgress } from '../progress';
import { paper, ref } from './helpers';

/**
 * What a search says while it runs: a new search can take half a minute, and
 * silence that long reads as a hang.
 */

function source(id: ProviderId, papers = 3): ProviderEntry {
  return {
    id,
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 100, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: () => 'native',
    normalizerVersion: 1,
    search: async () => ({
      papers: Array.from({ length: papers }, (_, i) =>
        paper({ id: `${id}:${i}`, title: `${id} ${i}`, doi: `10.1234/${id}.${i}`, sources: [ref(id, { nativeId: String(i) })] })),
      totalHits: papers,
      skipped: []
    })
  };
}

const listen = () => {
  const events: SearchProgress[] = [];
  return { events, onProgress: (event: SearchProgress) => { events.push(event); } };
};

describe('a search’s progress', () => {
  it('reports each source as it settles, then the page’s details', async () => {
    const { events, onProgress } = listen();

    await runOrchestrator({ q: 'crispr', pageSize: 2 }, {
      providers: [source('arxiv'), source('europepmc'), source('doaj')], authorities: [], onProgress
    });

    const sources = events.filter(e => e.stage === 'sources');
    expect(sources.map(e => e.settled)).toEqual([1, 2, 3]);
    expect(sources.every(e => e.planned === 3)).toBe(true);
    expect(sources.map(e => e.report.provider).sort()).toEqual(['arxiv', 'doaj', 'europepmc']);
    expect(events.at(-1)).toEqual({ stage: 'details', papers: 2 });
  });

  it('reports only the details for a page of a held set, since nothing was asked', async () => {
    const resultSets = new ResultSetCache();
    const providers = [source('arxiv', 5)];
    await runOrchestrator({ q: 'crispr', pageSize: 2 }, { providers, authorities: [], resultSets });

    const { events, onProgress } = listen();
    await runOrchestrator({ q: 'crispr', page: 2, pageSize: 2 }, { providers, authorities: [], resultSets, onProgress });

    expect(events).toEqual([{ stage: 'details', papers: 2 }]);
  });

  it('reports the access check when it will ask about papers', async () => {
    const rescuer: AuthorityEntry = {
      id: 'unpaywall',
      capabilities: { fields: ['fullText', 'oaStatus'], authoritative: ['fullText', 'oaStatus'] },
      pass: 0,
      lookup: async () => null
    };
    const gated: ProviderEntry = {
      ...source('europepmc'),
      search: async () => ({
        papers: [1, 2].map(i => paper({
          id: `europepmc:${i}`, doi: `10.1234/gated.${i}`, sources: [ref('europepmc', { nativeId: String(i) })], fullText: undefined
        })),
        totalHits: 2,
        skipped: []
      })
    };
    const { events, onProgress } = listen();

    await runOrchestrator({ q: 'crispr' }, { providers: [gated], authorities: [rescuer], onProgress });

    expect(events.map(e => e.stage)).toEqual(['sources', 'access']);
    expect(events[1]).toEqual({ stage: 'access', candidates: 2 });
  });

  it('is not hurt by a listener that throws', async () => {
    const response = await runOrchestrator({ q: 'crispr' }, {
      providers: [source('arxiv')],
      authorities: [],
      onProgress: () => { throw new Error('listener bug'); }
    });

    expect(response.total).toBe(3);
  });
});

describe('a count’s progress', () => {
  it('reports each source as it settles', async () => {
    const { events, onProgress } = listen();

    await countSearch({ q: 'crispr' }, { providers: [source('arxiv'), source('europepmc')], onProgress });

    expect(events.map(e => e.stage === 'sources' && [e.settled, e.planned])).toEqual([[1, 2], [2, 2]]);
  });
});
