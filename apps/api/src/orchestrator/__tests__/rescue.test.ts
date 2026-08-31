import { describe, it, expect, vi } from 'vitest';
import type { AuthorityFacts, Paper } from '@open-access-explorer/shared';
import { rescueCandidates, canRescue } from '../rescue';
import { AuthorityCache } from '../authority-cache';
import type { AuthorityEntry } from '../../authorities';
import { paper } from './helpers';

/**
 * The gap this covers: `applyPolicy` drops a paper with no retrievable copy,
 * and enrichment — which is where a copy would have come from — only ever ran
 * on the page that paper never reached. It was excluded from `total`, from the
 * facets, and from anything in the response that could have said so.
 */

function authority(
  id: any,
  facts: AuthorityFacts | null,
  over: Partial<AuthorityEntry> = {}
): AuthorityEntry {
  return {
    id,
    capabilities: { fields: ['fullText', 'oaStatus'], authoritative: ['fullText', 'oaStatus'] },
    pass: 0,
    lookup: async () => facts,
    ...over
  };
}

const PDF = { url: 'https://example.org/rescued.pdf', kind: 'pdf' as const, verified: false };

/** Passes every filter, carries a DOI, and has no copy — the shape the gate drops. */
const candidate = (over: Partial<Paper> = {}) =>
  paper({ id: 'europepmc:c', doi: '10.1/c', fullText: undefined, ...over });

const unpaywall = (facts: AuthorityFacts | null = { fullText: PDF }) => authority('unpaywall', facts);

describe('canRescue', () => {
  it('asks only the authorities that are authoritative on a gated field', () => {
    expect(canRescue(unpaywall())).toBe(true);
    expect(canRescue(authority('opencitations', {}, {
      capabilities: { fields: ['citationCount'], authoritative: [] }
    }))).toBe(false);
  });

  it('does not ask a gap-filler that merely declares fullText', () => {
    // Crossref's PDF links are `intended-application: text-mining`, several of
    // them pointing at api.wiley.com. Tolerable on a page that is already
    // being returned; not a reason to admit a paper to the result set.
    const crossref = authority('crossref', { fullText: PDF }, {
      capabilities: { fields: ['fullText', 'landingPage'], authoritative: [] }
    });
    expect(canRescue(crossref)).toBe(false);
  });
});

describe('rescueCandidates', () => {
  it('returns a paper the gate dropped once an authority supplies a copy', async () => {
    const { papers, report } = await rescueCandidates([candidate()], {
      authorities: [unpaywall()]
    });

    expect(papers).toHaveLength(1);
    expect(papers[0].fullText?.url).toBe(PDF.url);
    expect(papers[0].fieldSources.fullText).toBe('unpaywall');
    expect(report).toMatchObject({ candidates: 1, examined: 1, rescued: 1, bounded: false });
  });

  it('leaves a paper dropped when the authority has no copy either', async () => {
    const { papers, report } = await rescueCandidates([candidate()], {
      authorities: [unpaywall(null)]
    });

    expect(papers).toHaveLength(0);
    expect(report).toMatchObject({ candidates: 1, examined: 1, rescued: 0 });
  });

  it('rescues a paper that was closed only because no route was known', async () => {
    // `isOpen` falls back to stage, and a paper with neither a route nor a
    // stage fails the open-access gate on an absence rather than a statement.
    const unknown = candidate({ oaStatus: 'unknown', stage: 'unknown', fullText: PDF });
    const { papers } = await rescueCandidates([unknown], {
      authorities: [unpaywall({ oaStatus: 'gold' })]
    });

    expect(papers).toHaveLength(1);
    expect(papers[0].oaStatus).toBe('gold');
  });

  it('re-tests a rescued paper against the filters the caller ticked', async () => {
    // The paper passed `oaStatus: ['gold']` while its route was still unknown
    // only because the filter had nothing to compare against. Admitting it on
    // the strength of the gate alone would put a bronze paper on a page the
    // caller asked to be gold.
    const { papers } = await rescueCandidates([candidate()], {
      authorities: [unpaywall({ fullText: PDF, oaStatus: 'bronze' })],
      filters: { oaStatus: ['gold'] }
    });

    expect(papers).toHaveLength(0);
  });

  it('spends the limit on the highest-ranked candidates and says it was bounded', async () => {
    const lookup = vi.fn(async () => ({ fullText: PDF }));
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ id: `europepmc:${i}`, doi: `10.1/${i}` }));

    const { papers, report } = await rescueCandidates(candidates, {
      authorities: [authority('unpaywall', null, { lookup })],
      limit: 2
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(papers.map(p => p.id)).toEqual(['europepmc:0', 'europepmc:1']);
    expect(report).toMatchObject({ candidates: 5, examined: 2, rescued: 2, bounded: true });
  });

  it('asks nobody when the limit is zero', async () => {
    const lookup = vi.fn(async () => ({ fullText: PDF }));
    const { report } = await rescueCandidates([candidate()], {
      authorities: [authority('unpaywall', null, { lookup })],
      limit: 0
    });

    expect(lookup).not.toHaveBeenCalled();
    // Deliberate, but still a shortfall: the papers are dropped unasked and
    // `total` is a lower bound, which is what `bounded` is for.
    expect(report).toMatchObject({ candidates: 1, examined: 0, rescued: 0, bounded: true });
  });

  it('is not bounded when no authority could have been asked in the first place', async () => {
    // Nothing was left unasked, so `total` is as complete as this
    // configuration can make it and should not claim otherwise.
    const { report } = await rescueCandidates([candidate()], { authorities: [] });
    expect(report).toMatchObject({ candidates: 1, examined: 0, bounded: false });
  });

  it('never mutates the papers it was handed', async () => {
    // They may be the same objects the provider cache is holding.
    const original = candidate();
    const { papers } = await rescueCandidates([original], { authorities: [unpaywall()] });

    expect(original.fullText).toBeUndefined();
    expect(papers[0]).not.toBe(original);
  });

  it('shares its lookups with the page enrichment through the cache', async () => {
    const lookup = vi.fn(async () => ({ fullText: PDF }));
    const cache = new AuthorityCache();

    await rescueCandidates([candidate()], {
      authorities: [authority('unpaywall', null, { lookup })],
      cache
    });
    // The same paper reaching enrichPage asks the same question.
    await cache.fetch('unpaywall', '10.1/c', lookup as any);

    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
