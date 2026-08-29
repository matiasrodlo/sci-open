import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { rank, fusionScore, overlapScore } from '../rank';
import { paper, ref } from './helpers';

const query = (over: Partial<Query> = {}): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('fusionScore', () => {
  it('rewards a better position', () => {
    expect(fusionScore(paper({ sources: [ref('europepmc', { rank: 0 })] })))
      .toBeGreaterThan(fusionScore(paper({ sources: [ref('europepmc', { rank: 50 })] })));
  });

  it('rewards agreement between providers over one provider\'s top hit', () => {
    // The property worth having in a fan-out: two providers both ranking a
    // paper mid-list is stronger evidence than one putting it first.
    const agreed = paper({ sources: [ref('europepmc', { rank: 10 }), ref('ncbi', { rank: 12 })] });
    const single = paper({ sources: [ref('europepmc', { rank: 0 })] });
    expect(fusionScore(agreed)).toBeGreaterThan(fusionScore(single));
  });
});

describe('overlapScore', () => {
  it('is zero when the query has nothing to match', () => {
    expect(overlapScore(paper({ title: 'anything' }), query())).toBe(0);
  });

  it('scores a title match above an abstract match', () => {
    const inTitle = paper({ title: 'crispr methods', abstract: 'unrelated' });
    const inAbstract = paper({ title: 'unrelated', abstract: 'crispr methods' });
    const q = query({ terms: ['crispr'] });
    expect(overlapScore(inTitle, q)).toBeGreaterThan(overlapScore(inAbstract, q));
  });

  it('requires a phrase to appear intact', () => {
    const q = query({ phrases: ['gene editing'] });
    expect(overlapScore(paper({ title: 'gene editing advances' }), q)).toBeGreaterThan(0);
    expect(overlapScore(paper({ title: 'editing the gene' }), q)).toBe(0);
  });

  it('weights a phrase above a bare term', () => {
    const phrase = overlapScore(paper({ title: 'gene editing' }), query({ phrases: ['gene editing'] }));
    const term = overlapScore(paper({ title: 'gene' }), query({ terms: ['gene'] }));
    expect(phrase).toBeGreaterThanOrEqual(term);
  });

  it('does not match a term inside a longer word', () => {
    expect(overlapScore(paper({ title: 'genetics' }), query({ terms: ['gene'] }))).toBe(0);
  });
});

describe('rank', () => {
  it('puts a query match above a better-ranked non-match', () => {
    const ordered = rank(
      [
        paper({ id: 'irrelevant', title: 'Something else entirely', sources: [ref('europepmc', { rank: 0 })] }),
        paper({ id: 'relevant', title: 'CRISPR gene editing', sources: [ref('europepmc', { rank: 40 })] })
      ],
      { query: query({ terms: ['crispr'], phrases: ['gene editing'] }) }
    );
    expect(ordered[0].paper.id).toBe('relevant');
  });

  it('interleaves providers rather than returning them in blocks', () => {
    // The measured failure: the old output was 13 contiguous per-provider
    // blocks because ordering was "group by source, OpenAlex first".
    const papers = [
      ...Array.from({ length: 5 }, (_, i) =>
        paper({ id: `e${i}`, title: `Paper E${i}`, sources: [ref('europepmc', { rank: i })] })),
      ...Array.from({ length: 5 }, (_, i) =>
        paper({ id: `n${i}`, title: `Paper N${i}`, sources: [ref('ncbi', { rank: i })] }))
    ];

    const sequence = rank(papers, { query: query({ terms: ['paper'] }) })
      .map(s => s.paper.sources[0].provider);

    // Run-length encode: contiguous blocks would give 2 runs for 2 providers.
    const runs = sequence.filter((p, i) => i === 0 || p !== sequence[i - 1]).length;
    expect(runs).toBeGreaterThan(2);
  });

  it('breaks a tie on quality, not arbitrarily', () => {
    const rich = paper({
      id: 'rich', title: 'T', abstract: 'x'.repeat(300), venue: 'Nature',
      sources: [ref('europepmc', { rank: 5 })]
    });
    const sparse = paper({
      id: 'sparse', title: 'T', abstract: undefined, venue: undefined,
      fullText: undefined, authors: [], sources: [ref('ncbi', { rank: 5 })]
    });
    const ordered = rank([sparse, rich], { query: query({ terms: ['t'] }) });
    expect(ordered[0].paper.id).toBe('rich');
  });

  it('is deterministic when everything ties', () => {
    const a = paper({ id: 'a', title: 'Same', sources: [ref('europepmc', { rank: 1 })] });
    const b = paper({ id: 'b', title: 'Same', sources: [ref('europepmc', { rank: 1 })] });
    expect(rank([a, b], { query: query() }).map(s => s.paper.id)).toEqual(['a', 'b']);
    expect(rank([b, a], { query: query() }).map(s => s.paper.id)).toEqual(['a', 'b']);
  });

  it('returns every paper it was given', () => {
    const papers = [paper({ id: 'a' }), paper({ id: 'b' }), paper({ id: 'c' })];
    expect(rank(papers, { query: query({ terms: ['x'] }) })).toHaveLength(3);
  });
});
