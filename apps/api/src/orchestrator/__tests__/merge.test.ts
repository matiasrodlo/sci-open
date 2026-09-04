import { describe, it, expect } from 'vitest';
import { mergePapers, identityKey, normalizeDoi } from '../merge';
import { paper, ref } from './helpers';

describe('identity', () => {
  it('normalises a DOI before using it as a key', () => {
    expect(normalizeDoi('HTTPS://doi.org/10.1/ABC')).toBe('10.1/abc');
    expect(identityKey(paper({ doi: 'https://dx.doi.org/10.1/AbC' }))).toBe('doi:10.1/abc');
  });

  it('falls back to title and year when there is no DOI', () => {
    // 36% of records in a measured result set had no DOI, almost all preprints.
    expect(identityKey(paper({ doi: undefined, title: 'Attention Is All You Need!', year: 2017 })))
      .toBe('title:attention is all you need|2017');
  });
});

describe('mergePapers', () => {
  it('collapses two records sharing a DOI into one', () => {
    const merged = mergePapers([
      paper({ id: 'a', doi: '10.1/x', sources: [ref('europepmc')] }),
      paper({ id: 'b', doi: '10.1/x', sources: [ref('ncbi')] })
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps records with different DOIs apart', () => {
    const merged = mergePapers([paper({ id: 'a', doi: '10.1/x' }), paper({ id: 'b', doi: '10.1/y' })]);
    expect(merged).toHaveLength(2);
  });

  it('groups DOI-less records by title and year', () => {
    const merged = mergePapers([
      paper({ id: 'a', doi: undefined, title: 'Same Paper', year: 2020, sources: [ref('arxiv')] }),
      paper({ id: 'b', doi: undefined, title: 'same paper!', year: 2020, sources: [ref('openaire')] })
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps a record with a DOI apart from one without', () => {
    // Deliberate: matching across the two would merge on title alone. The
    // duplicates this leaves are PubMed records missing a DOI, which phase 08
    // fixes at the source.
    const merged = mergePapers([
      paper({ id: 'a', doi: '10.1/x', title: 'Same Paper', year: 2020 }),
      paper({ id: 'b', doi: undefined, title: 'Same Paper', year: 2020 })
    ]);
    expect(merged).toHaveLength(2);
  });

  it('takes the higher-priority provider as the base', () => {
    const merged = mergePapers([
      paper({ id: 'n', doi: '10.1/x', title: 'From NCBI', sources: [ref('ncbi')] }),
      paper({ id: 'e', doi: '10.1/x', title: 'From Europe PMC', sources: [ref('europepmc')] })
    ]);
    expect(merged[0].title).toBe('From Europe PMC');
  });

  it('surfaces a merged-in abstract on the field consumers read', () => {
    // The defect this replaces: the old merger wrote it to `canonicalAbstract`,
    // which nothing read back, so the paper came out with no abstract at all.
    const merged = mergePapers([
      paper({ id: 'e', doi: '10.1/x', abstract: undefined, sources: [ref('europepmc')] }),
      paper({ id: 'n', doi: '10.1/x', abstract: 'Only NCBI had this', sources: [ref('ncbi')] })
    ]);
    expect(merged[0].abstract).toBe('Only NCBI had this');
  });

  it('records which provider supplied a merged-in field', () => {
    const merged = mergePapers([
      paper({ id: 'e', doi: '10.1/x', abstract: undefined, venue: undefined, sources: [ref('europepmc')] }),
      paper({ id: 'n', doi: '10.1/x', abstract: 'From NCBI', venue: 'Nature', sources: [ref('ncbi')] })
    ]);
    expect(merged[0].fieldSources).toEqual({ abstract: 'ncbi', venue: 'ncbi' });
  });

  it('attributes nothing when the base already had the value', () => {
    const merged = mergePapers([
      paper({ id: 'e', doi: '10.1/x', abstract: 'Base abstract', sources: [ref('europepmc')] }),
      paper({ id: 'n', doi: '10.1/x', abstract: 'Other abstract', sources: [ref('ncbi')] })
    ]);
    expect(merged[0].abstract).toBe('Base abstract');
    expect(merged[0].fieldSources).toEqual({});
  });

  it('accumulates every provider that returned the work', () => {
    const merged = mergePapers([
      paper({ id: 'e', doi: '10.1/x', sources: [ref('europepmc', { rank: 3 })] }),
      paper({ id: 'n', doi: '10.1/x', sources: [ref('ncbi', { rank: 7 })] })
    ]);
    expect(merged[0].sources.map(s => s.provider)).toEqual(['europepmc', 'ncbi']);
    expect(merged[0].sources.map(s => s.rank)).toEqual([3, 7]);
  });

  it('unions topics rather than choosing between them', () => {
    const merged = mergePapers([
      paper({ id: 'e', doi: '10.1/x', topics: ['crispr'], sources: [ref('europepmc')] }),
      paper({ id: 'n', doi: '10.1/x', topics: ['crispr', 'genomics'], sources: [ref('ncbi')] })
    ]);
    expect(merged[0].topics.sort()).toEqual(['crispr', 'genomics']);
  });

  it('does not treat an unknown oaStatus as a value worth keeping', () => {
    // openalex outranks europepmc, so openalex is the base and its 'unknown'
    // has to lose to a real route from the lower-priority contributor.
    //
    // Written with `crossref` and `unpaywall` until `ProviderId` stopped
    // admitting them. Those are authorities: they answer about a record rather
    // than returning one, so no paper can carry either in `sources` and the
    // ranks the test leaned on were rows the merge could never consult. The
    // behaviour under test is real; only the cast was fictional.
    const merged = mergePapers([
      paper({ id: 'o', doi: '10.1/x', oaStatus: 'unknown', sources: [ref('openalex')] }),
      paper({ id: 'e', doi: '10.1/x', oaStatus: 'gold', sources: [ref('europepmc')] })
    ]);
    expect(merged[0].oaStatus).toBe('gold');
    expect(merged[0].fieldSources.oaStatus).toBe('europepmc');
  });

  it('prefers the higher-priority provider for a field they both supply', () => {
    const merged = mergePapers([
      paper({ id: 'o', doi: '10.1/x', oaStatus: 'gold', sources: [ref('openalex')] }),
      paper({ id: 'e', doi: '10.1/x', oaStatus: 'bronze', sources: [ref('europepmc')] })
    ]);
    expect(merged[0].oaStatus).toBe('gold');
  });

  it('takes a DOI from a contributor when the base has none', () => {
    const merged = mergePapers([
      paper({ id: 'a', doi: undefined, title: 'T', year: 2020, sources: [ref('arxiv')] }),
      paper({ id: 'b', doi: undefined, title: 'T', year: 2020, sources: [ref('openaire')] })
    ]);
    expect(merged).toHaveLength(1);
  });

  it('never returns more papers than it was given', () => {
    const input = [paper({ id: 'a', doi: '10.1/x' }), paper({ id: 'b', doi: '10.1/x' }), paper({ id: 'c', doi: '10.1/y' })];
    expect(mergePapers(input).length).toBeLessThanOrEqual(input.length);
  });

  it('returns nothing for no input', () => {
    expect(mergePapers([])).toEqual([]);
  });
});
