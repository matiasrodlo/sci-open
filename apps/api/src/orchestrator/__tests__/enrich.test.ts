import { describe, it, expect, vi } from 'vitest';
import type { AuthorityFacts, Paper } from '@open-access-explorer/shared';
import { enrichPage, applyFacts, betterFullText } from '../enrich';
import type { AuthorityEntry } from '../../authorities';
import { paper } from './helpers';

function authority(
  id: any,
  facts: AuthorityFacts | null,
  over: Partial<AuthorityEntry> = {}
): AuthorityEntry {
  return {
    id,
    capabilities: { fields: Object.keys(facts ?? {}) as any, authoritative: [] },
    pass: 0,
    lookup: async () => facts,
    ...over
  };
}

const withDoi = (over: Partial<Paper> = {}) => paper({ doi: '10.1/a', ...over });

describe('enrichPage', () => {
  it('fills a gap and records who filled it', async () => {
    const { papers } = await enrichPage([withDoi()], {
      authorities: [authority('crossref', { publisher: 'Springer' })]
    });

    expect(papers[0].publisher).toBe('Springer');
    expect(papers[0].fieldSources.publisher).toBe('crossref');
  });

  it('leaves a value a provider already supplied alone', async () => {
    const { papers } = await enrichPage([withDoi({ publisher: 'Elsevier' })], {
      authorities: [authority('crossref', { publisher: 'Springer' })]
    });

    expect(papers[0].publisher).toBe('Elsevier');
    expect(papers[0].fieldSources.publisher).toBeUndefined();
  });

  it('lets an authoritative field overwrite one that is already there', async () => {
    const unpaywall = authority('unpaywall', { oaStatus: 'bronze' }, {
      capabilities: { fields: ['oaStatus'], authoritative: ['oaStatus'] }
    });

    const { papers } = await enrichPage([withDoi({ oaStatus: 'gold' })], { authorities: [unpaywall] });

    expect(papers[0].oaStatus).toBe('bronze');
    expect(papers[0].fieldSources.oaStatus).toBe('unpaywall');
  });

  it('adds topics rather than choosing between vocabularies', async () => {
    const { papers } = await enrichPage([withDoi({ topics: ['crispr'] })], {
      authorities: [authority('crossref', { topics: ['crispr', 'genetics'] })]
    });

    expect(papers[0].topics).toEqual(['crispr', 'genetics']);
  });

  it('fills a stage without attributing it, since FieldSources has no slot', async () => {
    const { papers } = await enrichPage([withDoi({ stage: 'unknown' })], {
      authorities: [authority('unpaywall', { stage: 'accepted' })]
    });

    expect(papers[0].stage).toBe('accepted');
    expect((papers[0].fieldSources as any).stage).toBeUndefined();
  });

  it('never asks about a paper with no DOI', async () => {
    const lookup = vi.fn(async () => ({ publisher: 'Springer' }));
    const { reports } = await enrichPage([paper()], {
      authorities: [authority('crossref', null, { lookup })]
    });

    expect(lookup).not.toHaveBeenCalled();
    expect(reports[0].status).toBe('skipped');
  });

  it('does not add, drop or reorder the page', async () => {
    const page = [withDoi({ id: 'a' }), withDoi({ id: 'b', doi: '10.1/b' }), paper({ id: 'c' })];
    const { papers } = await enrichPage(page, {
      authorities: [authority('crossref', { publisher: 'Springer' })]
    });

    expect(papers.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the papers it was handed', async () => {
    // The page may be the same objects the provider cache is holding.
    const original = withDoi();
    await enrichPage([original], { authorities: [authority('crossref', { publisher: 'Springer' })] });

    expect(original.publisher).toBeUndefined();
    expect(original.fieldSources).toEqual({});
  });

  it('does not enrol an authority in `sources`', async () => {
    // `sources` is every provider that *returned* this work, and `rank` is a
    // position in a result list an authority never produced. Filtering by
    // source would otherwise match every paper on the page.
    const { papers } = await enrichPage([withDoi()], {
      authorities: [authority('crossref', { publisher: 'Springer' })]
    });

    expect(papers[0].sources.map(s => s.provider)).toEqual(['europepmc']);
  });

  describe('the PMC download gate', () => {
    const gated = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10328345/pdf/x.pdf';
    const rewritten = 'https://europepmc.org/articles/PMC10328345?pdf=render';

    it('rewrites it on a paper no authority touched', async () => {
      const { papers } = await enrichPage(
        [paper({ fullText: { url: gated, kind: 'pdf', verified: false } })],
        { authorities: [] }
      );

      expect(papers[0].fullText?.url).toBe(rewritten);
    });

    it('swaps in a copy that escapes it', async () => {
      const unpaywall = authority('unpaywall', {
        fullText: { url: 'https://example.org/a.pdf', kind: 'pdf', verified: false }
      }, { capabilities: { fields: ['fullText'], authoritative: ['fullText'] } });

      const { papers } = await enrichPage(
        [withDoi({ fullText: { url: gated, kind: 'pdf', verified: false } })],
        { authorities: [unpaywall] }
      );

      // The incumbent is rewritten before the candidate is considered, so both
      // are now real PDFs and the incumbent is kept.
      expect(papers[0].fullText?.url).toBe(rewritten);
    });
  });

  it('will not let an authority that has not claimed fullText replace one', async () => {
    // Crossref's PDF links are text-mining links; some want a TDM token. It
    // may fill a gap and nothing more.
    const crossref = authority('crossref', {
      fullText: { url: 'https://api.wiley.com/tdm/a.pdf', kind: 'pdf', verified: false }
    }, { capabilities: { fields: ['fullText'], authoritative: [] } });

    const held = { url: 'https://example.org/held', kind: 'html' as const, verified: false };
    const { papers } = await enrichPage([withDoi({ fullText: held })], { authorities: [crossref] });
    expect(papers[0].fullText).toEqual(held);

    const { papers: gap } = await enrichPage([withDoi({ fullText: undefined })], { authorities: [crossref] });
    expect(gap[0].fullText?.url).toBe('https://api.wiley.com/tdm/a.pdf');
  });

  describe('betterFullText', () => {
    const pdf = { url: 'https://example.org/a.pdf', kind: 'pdf' as const, verified: false };

    it('takes anything over nothing', () => {
      expect(betterFullText(undefined, pdf)).toBe(true);
    });

    it('does not trade a landing page for a PDF', () => {
      // Tried and measured: 17 substitutions, 1 fixed, 1 regressed, and the
      // page's download rate fell from 72% to 67%. The rule was swapping
      // resolver URLs that work for publisher URLs that answer 403.
      expect(betterFullText({ url: 'https://doaj.org/a', kind: 'html', verified: false }, pdf)).toBe(false);
    });

    it('escapes a URL known to serve a gate', () => {
      const gated = { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/pdf/x.pdf', kind: 'pdf' as const, verified: false };
      expect(betterFullText(gated, pdf)).toBe(true);
    });

    it('does not swap one working PDF for another', () => {
      // A repository copy is not better than a publisher copy the search
      // provider already gave us just because Unpaywall mentioned it.
      expect(betterFullText({ ...pdf, url: 'https://nature.com/a.pdf' }, pdf)).toBe(false);
    });

    it('keeps a copy we confirmed over one merely claimed', () => {
      expect(betterFullText({ ...pdf, verified: true }, pdf)).toBe(false);
    });
  });

  describe('the second pass', () => {
    it('only asks about papers the first pass left unanswered', async () => {
      const counts = vi.fn(async () => ({ citationCount: 7 }));
      const opencitations = authority('opencitations', null, {
        pass: 1,
        capabilities: { fields: ['citationCount'], authoritative: [] },
        wants: p => p.citationCount === undefined,
        lookup: counts
      });

      const { papers, reports } = await enrichPage(
        [withDoi({ id: 'a' }), withDoi({ id: 'b', doi: '10.1/b' })],
        {
          authorities: [
            authority('openalex', { citationCount: 99 }, {
              capabilities: { fields: ['citationCount'], authoritative: [] },
              // Only the first paper gets a count from pass 0.
              lookup: async ({ doi }) => (doi === '10.1/a' ? { citationCount: 99 } : null)
            }),
            opencitations
          ]
        }
      );

      expect(counts).toHaveBeenCalledTimes(1);
      expect(papers.map(p => p.citationCount)).toEqual([99, 7]);
      expect(reports.find(r => r.authority === 'opencitations')).toMatchObject({ asked: 1, applied: 1 });
    });
  });

  describe('reports', () => {
    it('counts what was asked, what answered and what it was worth', async () => {
      const { reports } = await enrichPage([withDoi(), withDoi({ doi: '10.1/b' })], {
        authorities: [
          authority('crossref', { publisher: 'Springer' }),
          authority('openalex', null)
        ]
      });

      expect(reports.find(r => r.authority === 'crossref')).toMatchObject({
        status: 'ok', asked: 2, answered: 2, applied: 2
      });
      // Asked, answered nothing: the DOI is simply not registered there.
      expect(reports.find(r => r.authority === 'openalex')).toMatchObject({
        status: 'ok', asked: 2, answered: 0, applied: 0
      });
    });

    it('reports an authority that only ever threw as errored', async () => {
      const { reports } = await enrichPage([withDoi()], {
        authorities: [authority('crossref', null, {
          capabilities: { fields: ['publisher'], authoritative: [] },
          lookup: async () => { throw new Error('Crossref 503'); }
        })]
      });

      expect(reports[0]).toMatchObject({ status: 'error', asked: 1, answered: 0, error: 'Crossref 503' });
    });

    it('gives up at the budget rather than holding the page open', async () => {
      const slow = authority('crossref', null, {
        capabilities: { fields: ['publisher'], authoritative: [] },
        lookup: () => new Promise(resolve => setTimeout(() => resolve({ publisher: 'Springer' }), 5000))
      });

      const started = Date.now();
      const { papers, reports } = await enrichPage([withDoi()], { authorities: [slow], budgetMs: 50 });

      expect(Date.now() - started).toBeLessThan(2000);
      expect(reports[0].status).toBe('timeout');
      // The page is still the page. Enrichment failing costs detail, not results.
      expect(papers).toHaveLength(1);
    });
  });
});

describe('applyFacts', () => {
  it('returns how many fields it actually wrote', () => {
    const target = withDoi({ venue: 'Nature' });
    const written = applyFacts(target, { venue: 'Science', publisher: 'Springer', year: 2020 },
      authority('crossref', null, {
        capabilities: { fields: ['venue', 'publisher', 'year'], authoritative: [] }
      }));

    // `venue` was already there; the other two were not.
    expect(written).toBe(2);
  });

  it('ignores a field the authority does not declare', () => {
    const target = withDoi();
    applyFacts(target, { publisher: 'Springer' } as any,
      authority('crossref', null, { capabilities: { fields: ['venue'], authoritative: [] } }));

    expect(target.publisher).toBeUndefined();
  });
});
