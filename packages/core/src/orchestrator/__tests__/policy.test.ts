import { describe, it, expect } from 'vitest';
import { applyPolicy, isOpen, partitionByPolicy } from '../policy';
import { paper, ref } from './helpers';

describe('isOpen', () => {
  it('believes a closed route even when a stage suggests otherwise', () => {
    expect(isOpen(paper({ oaStatus: 'closed', stage: 'published' }))).toBe(false);
  });

  it.each(['gold', 'green', 'hybrid', 'bronze'] as const)('accepts the %s route', route => {
    expect(isOpen(paper({ oaStatus: route }))).toBe(true);
  });

  it('falls back to stage before enrichment has supplied a route', () => {
    expect(isOpen(paper({ oaStatus: 'unknown', stage: 'preprint' }))).toBe(true);
    expect(isOpen(paper({ oaStatus: 'unknown', stage: 'unknown' }))).toBe(false);
  });
});

describe('applyPolicy — the rules that used to be invisible', () => {
  it('requires a retrievable copy by default', () => {
    expect(applyPolicy([paper({ fullText: undefined })])).toHaveLength(0);
  });

  it('can be asked not to, which was previously impossible', () => {
    // These were hard filters in the middle of applyFilters, applied whether
    // or not the caller wanted them and invisible from outside.
    const out = applyPolicy([paper({ fullText: undefined })], {}, { requireFullText: false });
    expect(out).toHaveLength(1);
  });

  it('requires open access by default, and can be asked not to', () => {
    const closed = [paper({ oaStatus: 'closed' })];
    expect(applyPolicy(closed)).toHaveLength(0);
    expect(applyPolicy(closed, {}, { requireOpenAccess: false })).toHaveLength(1);
  });
});

describe('applyPolicy — user filters', () => {
  it('matches a source against every provider that returned the paper', () => {
    // A merged paper genuinely came from all of them; the old shape could only
    // record one.
    const merged = paper({ sources: [ref('europepmc'), ref('ncbi')] });
    expect(applyPolicy([merged], { source: ['ncbi'] })).toHaveLength(1);
  });

  it('excludes an undated paper from a year bound', () => {
    // The old filter guarded on the year being present, so an undated record
    // satisfied every year filter.
    expect(applyPolicy([paper({ year: undefined })], { yearFrom: 2020 })).toHaveLength(0);
  });

  it('treats year bounds as inclusive', () => {
    const papers = [paper({ id: '19', year: 2019 }), paper({ id: '20', year: 2020 }), paper({ id: '21', year: 2021 })];
    expect(applyPolicy(papers, { yearFrom: 2020, yearTo: 2021 }).map(p => p.id)).toEqual(['20', '21']);
  });

  it('filters by stage', () => {
    const p = paper({ stage: 'preprint' });
    expect(applyPolicy([p], { stage: ['preprint'] })).toHaveLength(1);
    expect(applyPolicy([p], { stage: ['published'] })).toHaveLength(0);
  });

  it('combines filters conjunctively', () => {
    const papers = [
      paper({ id: 'a', year: 2020, stage: 'published' }),
      paper({ id: 'b', year: 2020, stage: 'preprint' })
    ];
    expect(applyPolicy(papers, { yearFrom: 2020, stage: ['preprint'] }).map(p => p.id)).toEqual(['b']);
  });

  it('returns everything when no filters are given', () => {
    expect(applyPolicy([paper({ id: 'a' }), paper({ id: 'b' })])).toHaveLength(2);
  });
});

describe('partitionByPolicy — what is settled and what is still a question', () => {
  const noCopy = (over = {}) => paper({ doi: '10.1/a', fullText: undefined, ...over });

  it('separates the papers the gate drops from the ones it keeps', () => {
    const { kept, candidates } = partitionByPolicy([paper({ id: 'has' }), noCopy({ id: 'not' })]);

    expect(kept.map(p => p.id)).toEqual(['has']);
    expect(candidates.map(p => p.id)).toEqual(['not']);
  });

  it('will not make a candidate of a paper with no DOI to ask about', () => {
    // The authorities are keyed by DOI, so there is no question left to ask.
    const { kept, candidates } = partitionByPolicy([noCopy({ doi: undefined })]);
    expect(kept).toHaveLength(0);
    expect(candidates).toHaveLength(0);
  });

  it('will not make a candidate of a paper the caller filtered out', () => {
    // A filter reads fields the providers supplied, so enrichment cannot
    // change the answer and the exclusion is settled.
    const { candidates } = partitionByPolicy([noCopy({ year: 1999 })], { yearFrom: 2020 });
    expect(candidates).toHaveLength(0);
  });

  it('has nothing to ask about when the gates are off', () => {
    const { kept, candidates } = partitionByPolicy([noCopy()], {}, { requireFullText: false });
    expect(kept).toHaveLength(1);
    expect(candidates).toHaveLength(0);
  });

  it('keeps candidates in the order they arrived, which is rank order', () => {
    const { candidates } = partitionByPolicy([
      noCopy({ id: 'a', doi: '10.1/a' }),
      paper({ id: 'kept' }),
      noCopy({ id: 'b', doi: '10.1/b' })
    ]);
    expect(candidates.map(p => p.id)).toEqual(['a', 'b']);
  });
});
