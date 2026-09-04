import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Query, SearchParams } from '@open-access-explorer/shared';
import type { AuthorityEntry } from '../../authorities';
import type { ProviderEntry } from '../registry';
import { runOrchestrator, toUserFilters } from '../from-search-params';
import { paper, ref } from './helpers';

/**
 * The conversion at the edge of the new path: what a request means once it
 * stops being `SearchParams` and starts being a `Query` plus options.
 *
 * A stub provider records the Query it was handed, so these assert what the
 * orchestrator was actually asked rather than what came back from it — the
 * fan-out has its own tests, and the interesting failures here are a filter
 * that silently does nothing.
 */

type Recorded = { query: Query; openAccessOnly: boolean };

function recorder(papers = pageOf(3)): { entry: ProviderEntry; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const entry: ProviderEntry = {
    id: 'europepmc',
    capabilities: {
      keywordSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false
    },
    translate: () => 'native',
    normalizerVersion: 1,
    search: async ({ query, openAccessOnly }) => {
      calls.push({ query, openAccessOnly });
      return { papers, totalHits: papers.length, skipped: [] };
    }
  };
  return { entry, calls };
}

const pageOf = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    paper({
      id: `europepmc:${i}`,
      title: `Study ${i}`,
      doi: `10.1/e-${i}`,
      year: 2020 + i,
      venue: `Journal ${i}`,
      sources: [ref('europepmc', { nativeId: String(i), rank: i })]
    }));

// Offline: the authorities are real I/O and nothing here is about them.
const run = (params: SearchParams, providers: ProviderEntry[]) =>
  runOrchestrator(params, { providers, authorities: [] });

describe('toUserFilters', () => {
  it('carries every filter the orchestrator can act on', () => {
    expect(toUserFilters({
      source: ['europepmc'], yearFrom: 2020, yearTo: 2024,
      oaStatus: ['gold'], venue: ['Nature'], publisher: ['NPG'], topics: ['crispr']
    })).toEqual({
      source: ['europepmc'], yearFrom: 2020, yearTo: 2024,
      oaStatus: ['gold'], venue: ['Nature'], publisher: ['NPG'], topics: ['crispr']
    });
  });

  it('omits absent filters rather than setting them undefined', () => {
    expect(toUserFilters({})).toEqual({});
  });

  // The old path answered this from which connector returned the record.
  it('answers publicationType from stage', () => {
    expect(toUserFilters({ publicationType: ['peer-reviewed'] }).stage).toEqual(['accepted', 'published']);
    expect(toUserFilters({ publicationType: ['preprint'] }).stage).toEqual(['preprint']);
    expect(toUserFilters({ publicationType: ['peer-reviewed', 'preprint'] }).stage)
      .toEqual(['accepted', 'published', 'preprint']);
  });

  it('drops a publicationType it has no stage for, rather than filtering everything out', () => {
    expect(toUserFilters({ publicationType: ['dataset'] }).stage).toBeUndefined();
  });
});

describe('runOrchestrator: what the providers are asked', () => {
  it('parses the query text into terms and phrases', async () => {
    const { entry, calls } = recorder();
    await run({ q: '"gut microbiome" obesity' }, [entry]);

    expect(calls[0]!.query.phrases).toEqual(['gut microbiome']);
    expect(calls[0]!.query.terms).toEqual(['obesity']);
    expect(calls[0]!.query.join).toBe('AND');
  });

  it('puts year bounds in the query so a provider can express them upstream', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr', filters: { yearFrom: 2022, yearTo: 2024 } }, [entry]);

    expect(calls[0]!.query.years).toEqual({ from: 2022, to: 2024 });
  });

  it('leaves years unset when neither bound was given', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr' }, [entry]);

    expect(calls[0]!.query.years).toBeUndefined();
  });

  it('recognises a DOI typed into q', async () => {
    const { entry, calls } = recorder();
    await run({ q: '10.1038/s41586-020-2008-3' }, [entry]);

    expect(calls[0]!.query.doi).toBe('10.1038/s41586-020-2008-3');
    expect(calls[0]!.query.terms).toEqual([]);
  });

  // The old path never read `params.doi` at all.
  it('prefers the doi field over q when both are set', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr', doi: '10.1038/s41586-020-2008-3' }, [entry]);

    expect(calls[0]!.query.doi).toBe('10.1038/s41586-020-2008-3');
  });

  it('asks for open access only unless the request says otherwise', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr' }, [entry]);
    await run({ q: 'crispr', filters: { openAccessOnly: false } }, [entry]);

    expect(calls[0]!.openAccessOnly).toBe(true);
    expect(calls[1]!.openAccessOnly).toBe(false);
  });
});

describe('runOrchestrator: the response', () => {
  it('is the shape the old path returns', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', page: 1, pageSize: 2 }, [entry]);

    expect(response.hits).toHaveLength(2);
    expect(response.total).toBe(5);
    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(2);
    expect(response.sort).toBe('relevance');
    expect(response.providerTotals).toEqual([
      { source: 'europepmc', totalHits: 5, retrieved: 5 }
    ]);
    expect(typeof response.duration).toBe('number');
  });

  it('defaults page and pageSize the way the old path did', async () => {
    const { entry } = recorder(pageOf(30));
    const response = await run({ q: 'crispr' }, [entry]);

    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(20);
    expect(response.hits).toHaveLength(20);
  });

  it('echoes filters only when the request carried them', async () => {
    const { entry } = recorder();
    expect((await run({ q: 'crispr' }, [entry])).filters).toBeUndefined();
    expect((await run({ q: 'crispr', filters: { yearFrom: 2020 } }, [entry])).filters)
      .toEqual({ yearFrom: 2020 });
  });

  it('reports completeness, which the old path had no way to express', async () => {
    const { entry } = recorder();
    expect((await run({ q: 'crispr' }, [entry])).complete).toBe(true);

    const failing: ProviderEntry = { ...entry, search: async () => { throw new Error('upstream down'); } };
    const response = await run({ q: 'crispr' }, [failing]);
    expect(response.complete).toBe(false);
    expect(response.providerTotals?.[0]?.error).toContain('upstream down');
  });

  it('applies the requested sort to the whole set, not to the page', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', sort: 'date', pageSize: 2 }, [entry]);

    // pageOf ascends by year, so a date sort has to bring the last ones forward.
    expect(response.hits.map(h => h.year)).toEqual([2024, 2023]);
    expect(response.sort).toBe('date');
  });

  /**
   * The other way `total` stops being an answer, and the one `complete` cannot
   * express.
   *
   * A paper failing the open-access gate on fields the authorities supply is
   * asked about before it is dropped — but only the first `SEARCH_RESCUE_LIMIT`
   * of them, so whatever the limit cuts off is dropped unasked and the count is
   * short with every provider having answered. That was visible only in a debug
   * log until it reached the response, which meant a reader was shown a bounded
   * total with nothing to mark it as one.
   */
  describe('a total bounded by the rescue', () => {
    /** Authoritative on a gated field, so `canRescue` picks it up. */
    const rescuer: AuthorityEntry = {
      id: 'unpaywall',
      capabilities: { fields: ['fullText', 'oaStatus'], authoritative: ['fullText', 'oaStatus'] },
      pass: 0,
      lookup: async () => null
    };

    /** Fails the gate — no copy — but carries the DOI that makes it askable. */
    const gated = (i: number) =>
      paper({
        id: `europepmc:${i}`,
        doi: `10.1234/gated.${i}`,
        sources: [ref('europepmc', { nativeId: String(i), rank: i })],
        fullText: undefined
      });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('says so when the limit cut the candidate list short', async () => {
      vi.stubEnv('SEARCH_RESCUE_LIMIT', '1');
      const { entry } = recorder([gated(1), gated(2)]);

      const response = await runOrchestrator({ q: 'crispr' }, {
        providers: [entry],
        authorities: [rescuer]
      });

      expect(response.bounded).toBe(true);
      // And it is not the same statement as `complete`: every provider answered.
      expect(response.complete).toBe(true);
    });

    it('says so when the step was turned off entirely', async () => {
      // A limit of zero is an operator's decision, but the count is a lower
      // bound for exactly the same reason.
      vi.stubEnv('SEARCH_RESCUE_LIMIT', '0');
      const { entry } = recorder([gated(1)]);

      const response = await runOrchestrator({ q: 'crispr' }, {
        providers: [entry],
        authorities: [rescuer]
      });

      expect(response.bounded).toBe(true);
    });

    it('is false when every candidate was asked about', async () => {
      vi.stubEnv('SEARCH_RESCUE_LIMIT', '50');
      const { entry } = recorder([gated(1), gated(2)]);

      const response = await runOrchestrator({ q: 'crispr' }, {
        providers: [entry],
        authorities: [rescuer]
      });

      expect(response.bounded).toBe(false);
    });

    it('is false when there was nothing to ask about', async () => {
      // Every paper passes the gate, so the rescue never runs.
      const { entry } = recorder();

      expect((await run({ q: 'crispr' }, [entry])).bounded).toBe(false);
    });

    /**
     * The budget, not the limit, is what decides how many candidates are
     * reached — 200 of them at a concurrency of 16 is 12.5 waves, and five
     * seconds only covers that if the mean lookup beats 400ms against a
     * per-lookup timeout of 2500ms. It had no setting at all while the limit,
     * which on a broad query is never the binding constraint, was the one an
     * operator was pointed at.
     */
    describe('SEARCH_RESCUE_BUDGET_MS', () => {
      /** Slower than any budget these tests set. */
      const slowRescuer: AuthorityEntry = {
        ...rescuer,
        lookup: () => new Promise(resolve => setTimeout(() => resolve(null), 500))
      };

      it('cuts the pass short, with the limit nowhere near reached', async () => {
        vi.stubEnv('SEARCH_RESCUE_LIMIT', '500');
        vi.stubEnv('SEARCH_RESCUE_BUDGET_MS', '20');
        const { entry } = recorder([gated(1), gated(2)]);

        const started = Date.now();
        const response = await runOrchestrator({ q: 'crispr' }, {
          providers: [entry],
          authorities: [slowRescuer]
        });

        // Held for the budget rather than for the lookup, which is the whole
        // point of the setting existing.
        expect(Date.now() - started).toBeLessThan(400);
        expect(response.bounded).toBe(true);
        expect(response.complete).toBe(true);
      });

      it('falls back to the default rather than honouring a zero', async () => {
        // A limit of zero means "do not run the step" and is honoured. A budget
        // of zero would mean "run it and abort before anything can return",
        // which spends the setup to guarantee nothing, so it is refused.
        vi.stubEnv('SEARCH_RESCUE_BUDGET_MS', '0');
        const { entry } = recorder([gated(1)]);

        const response = await runOrchestrator({ q: 'crispr' }, {
          providers: [entry],
          authorities: [rescuer]
        });

        expect(response.bounded).toBe(false);
      });

      it('ignores a value that is not a number', async () => {
        vi.stubEnv('SEARCH_RESCUE_BUDGET_MS', 'soon');
        const { entry } = recorder([gated(1)]);

        expect((await runOrchestrator({ q: 'crispr' }, {
          providers: [entry],
          authorities: [rescuer]
        })).bounded).toBe(false);
      });
    });
  });
});
