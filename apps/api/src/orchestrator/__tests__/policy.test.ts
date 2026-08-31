import { describe, it, expect } from 'vitest';
import { applyPolicy, isOpen } from '../policy';
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
  it('filters by oaStatus, which the old pipeline never read', () => {
    // Declared on SearchFilters, documented, faceted — and ignored, so a
    // client filtering on it got the unfiltered set back.
    const papers = [
      paper({ id: 'g', oaStatus: 'gold' }),
      paper({ id: 'b', oaStatus: 'bronze' })
    ];
    expect(applyPolicy(papers, { oaStatus: ['gold'] }).map(p => p.id)).toEqual(['g']);
  });

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

  // The year facet ticks exact years rather than a bound, and sends them as
  // strings. `toUserFilters` used to drop the field between the schema that
  // accepted it and the filter that would have applied it, so ticking a year
  // re-ran the search and returned everything — the same defect this file's
  // header records for `oaStatus`, one field along.
  it('filters by exact years from the facet', () => {
    const papers = [paper({ id: '19', year: 2019 }), paper({ id: '20', year: 2020 }), paper({ id: '21', year: 2021 })];
    expect(applyPolicy(papers, { year: ['2019', '2021'] }).map(p => p.id)).toEqual(['19', '21']);
  });

  it('excludes an undated paper from an exact-year filter', () => {
    expect(applyPolicy([paper({ year: undefined })], { year: ['2020'] })).toHaveLength(0);
  });

  it('applies an exact-year filter and a year bound together', () => {
    const papers = [paper({ id: '19', year: 2019 }), paper({ id: '20', year: 2020 }), paper({ id: '21', year: 2021 })];
    expect(
      applyPolicy(papers, { year: ['2019', '2021'], yearFrom: 2020 }).map(p => p.id)
    ).toEqual(['21']);
  });

  it('ignores an empty exact-year list rather than excluding everything', () => {
    expect(applyPolicy([paper({ year: 2020 })], { year: [] })).toHaveLength(1);
  });

  it('filters by stage, venue, publisher and topic', () => {
    const p = paper({ stage: 'preprint', venue: 'bioRxiv', publisher: 'CSHL', topics: ['crispr'] });
    expect(applyPolicy([p], { stage: ['preprint'] })).toHaveLength(1);
    expect(applyPolicy([p], { venue: ['bioRxiv'] })).toHaveLength(1);
    expect(applyPolicy([p], { publisher: ['CSHL'] })).toHaveLength(1);
    expect(applyPolicy([p], { topics: ['crispr'] })).toHaveLength(1);
    expect(applyPolicy([p], { venue: ['Nature'] })).toHaveLength(0);
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
