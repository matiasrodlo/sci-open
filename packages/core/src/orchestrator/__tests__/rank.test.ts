import { describe, it, expect } from 'vitest';
import type { Query } from '@sci-open/shared';
import { rank, fusionScore, overlapScore, exactTitle, isNoticeTitle } from '../rank';
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

  it('matches terms in any script, ignoring accents', () => {
    const exact = (title: string, terms: string[]) => overlapScore(paper({ title }), query({ terms }));
    // An exact title match scores the same whatever alphabet it is written in.
    const ascii = exact('cancer detection', ['cancer', 'detection']);
    expect(exact('Détection cancer', ['détection', 'cancer'])).toBe(ascii);
    expect(exact('Detection cancer', ['détection', 'cancer'])).toBe(ascii);
    expect(exact('Лечение детей', ['лечение', 'детей'])).toBe(ascii);
  });

  it('matches a hyphenated term however the text punctuates it', () => {
    expect(overlapScore(paper({ title: 'COVID 19 in children' }), query({ terms: ['covid-19'] })))
      .toBeGreaterThan(0);
    expect(overlapScore(paper({ title: 'covid-19 in children' }), query({ terms: ['covid-19'] })))
      .toBeGreaterThan(0);
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

  /**
   * Phase 06 wrote this against two providers and noted it would only mean
   * something once more were migrated. Nine are, so it now runs against the
   * six that answer a keyword query.
   *
   * It is also the one property that separates the two paths. The old path
   * does not rank at all — `sortResults` answers `'relevance'` with
   * `return records`, so its order is the order providers were concatenated
   * in. Measured live: its page one was twenty consecutive Europe PMC
   * records. That is what this asserts cannot happen here.
   */
  it('interleaves providers rather than returning them in blocks', () => {
    const providers = ['europepmc', 'ncbi', 'plos', 'doaj', 'openaire', 'arxiv'] as const;
    const papers = providers.flatMap(provider =>
      Array.from({ length: 10 }, (_, i) =>
        paper({
          id: `${provider}-${i}`,
          title: `Paper about crispr ${provider} ${i}`,
          sources: [ref(provider, { rank: i })]
        }))
    );

    const sequence = rank(papers, { query: query({ terms: ['crispr'] }) })
      .map(s => s.paper.sources[0].provider);

    // Contiguous blocks would give exactly one run per provider.
    const runs = sequence.filter((p, i) => i === 0 || p !== sequence[i - 1]).length;
    expect(runs).toBeGreaterThan(providers.length * 2);
  });

  it('never fills the first page from a single provider', () => {
    // The failure this exists to prevent, stated directly: the old path's
    // page one run-length encodes to `europepmc x20`.
    const providers = ['europepmc', 'ncbi', 'plos', 'doaj', 'openaire', 'arxiv'] as const;
    const papers = providers.flatMap(provider =>
      Array.from({ length: 30 }, (_, i) =>
        paper({
          id: `${provider}-${i}`,
          title: `Paper about crispr ${provider} ${i}`,
          sources: [ref(provider, { rank: i })]
        }))
    );

    const firstPage = rank(papers, { query: query({ terms: ['crispr'] }) })
      .slice(0, 20)
      .map(s => s.paper.sources[0].provider);

    expect(new Set(firstPage).size).toBeGreaterThan(1);
    // No provider may own more than half of it.
    for (const provider of providers) {
      expect(firstPage.filter(p => p === provider).length).toBeLessThanOrEqual(10);
    }
  });

  it('finds a paper first by its own title, above papers several sources hold that quote it', () => {
    // The recorded TI="attention is all you need": arXiv alone returned the
    // paper, first; a 2026 correction notice and a drug-discovery review
    // borrowing the title came from three sources each, and ranked above it.
    const q = query({ phrases: ['attention is all you need'] });
    const canonical = paper({ id: 'arxiv:1706.03762v7', title: 'Attention Is All You Need', sources: [ref('arxiv', { rank: 0 })] });
    const correction = paper({
      id: 'openalex:W7158626848', title: 'Correction to: Attention is all you need: utilizing attention in AI-enabled drug discovery',
      sources: [ref('openalex', { rank: 28 }), ref('europepmc', { rank: 0 }), ref('openaire', { rank: 4 })]
    });
    const borrowed = paper({
      id: 'openalex:W4390678101', title: 'Attention is all you need: utilizing attention in AI-enabled drug discovery',
      sources: [ref('openalex', { rank: 2 }), ref('europepmc', { rank: 1 }), ref('openaire', { rank: 43 })]
    });

    expect(rank([correction, borrowed, canonical], { query: q }).map(s => s.paper.id))
      .toEqual(['arxiv:1706.03762v7', 'openalex:W4390678101', 'openalex:W7158626848']);
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

describe('exactTitle', () => {
  it('is a quoted phrase or every word searched, whatever the case and punctuation', () => {
    const p = paper({ title: 'Attention Is All You Need.' });
    expect(exactTitle(p, query({ phrases: ['attention is all you need'] }))).toBe(true);
    expect(exactTitle(p, query({ terms: ['attention', 'is', 'all', 'you', 'need'] }))).toBe(true);
    expect(exactTitle(p, query({ terms: ['attention'] }))).toBe(false);
    expect(exactTitle(paper({ title: 'Attention is all you need: a review' }), query({ phrases: ['attention is all you need'] }))).toBe(false);
  });
});

describe('isNoticeTitle', () => {
  it.each([
    'Correction to: Attention is all you need', 'Author Correction: A paper', 'Publisher Correction: A paper',
    'Corrigendum to "A paper"', 'Erratum: A paper', 'Retraction: A paper', 'Retraction Note: A paper',
    'Notice of Retraction: A paper', 'Expression of Concern: A paper', 'Reply to Smith et al.', 'Comment on "A paper"'
  ])('reads %s as a notice', title => expect(isNoticeTitle(title)).toBe(true));

  it.each([
    'Correctional facilities and health', 'Error correction in quantum codes', 'Retractions in the scientific literature',
    'RETRACTED: A paper the journal retracted', 'Commentary on method choice', 'Responses to drought in maize'
  ])('reads %s as a paper', title => expect(isNoticeTitle(title)).toBe(false));
});
