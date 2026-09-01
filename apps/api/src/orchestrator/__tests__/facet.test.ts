import { describe, it, expect } from 'vitest';
import { facetBaseSets, generateFacets } from '../facet';
import { matchesFilters } from '../policy';
import { paper, ref } from './helpers';

describe('generateFacets', () => {
  const papers = [
    paper({ id: 'a', year: 2020, venue: 'Nature', publisher: 'Springer', topics: ['crispr'], stage: 'published' }),
    paper({ id: 'b', year: 2021, venue: 'Cell', publisher: 'Elsevier', topics: ['crispr', 'genomics'], stage: 'preprint' }),
    paper({ id: 'c', year: 2020, venue: 'Nature', publisher: 'Springer', topics: [], stage: 'published' })
  ];

  it('counts single-valued facets so the buckets sum to the result count', () => {
    // The invariant the panel rests on: selecting a bucket narrows the set by
    // exactly the number shown.
    const f = generateFacets(papers);
    for (const key of ['year', 'venue', 'publisher', 'stage']) {
      expect(f[key].reduce((t, b) => t + b.count, 0), key).toBe(papers.length);
    }
  });

  it('counts a merged paper once for every provider that returned it', () => {
    const merged = paper({ sources: [ref('europepmc'), ref('ncbi')] });
    const f = generateFacets([merged]);
    expect(f.source).toEqual([
      { value: 'europepmc', count: 1 },
      { value: 'ncbi', count: 1 }
    ]);
  });

  it('counts one provider once, however many of its ids landed on the paper', () => {
    // `sources` is keyed by provider *and* native id, so a provider that
    // returned the same work under two of its own ids leaves two refs behind.
    // Counting refs made the bucket larger than the result set it describes:
    // measured on "alzheimer amyloid", Europe PMC's 600 records merged into
    // 584 papers and the bucket still read 600, in the same response whose
    // total was 584.
    const merged = paper({
      sources: [
        ref('europepmc', { nativeId: 'MED-1' }),
        ref('europepmc', { nativeId: 'PMC-1' }),
        ref('ncbi')
      ]
    });

    expect(generateFacets([merged]).source).toEqual([
      { value: 'europepmc', count: 1 },
      { value: 'ncbi', count: 1 }
    ]);
  });

  it('keeps every source bucket no larger than the number of papers', () => {
    const f = generateFacets(papers);
    for (const bucket of f.source) {
      expect(bucket.count, `source=${bucket.value}`).toBeLessThanOrEqual(papers.length);
    }
  });

  it('counts topics per occurrence, since a paper carries several', () => {
    expect(generateFacets(papers).topics).toEqual([
      { value: 'crispr', count: 2 },
      { value: 'genomics', count: 1 }
    ]);
  });

  it('orders buckets by count, so truncation keeps the head', () => {
    const f = generateFacets(papers);
    expect(f.venue[0]).toEqual({ value: 'Nature', count: 2 });
  });

  it('orders years newest first', () => {
    expect(generateFacets(papers).year.map(b => b.value)).toEqual([2021, 2020]);
  });

  it('caps open-ended facets at 25 without rescaling the survivors', () => {
    const wide = Array.from({ length: 200 }, (_, i) =>
      paper({ id: `p${i}`, venue: `Journal ${i}`, topics: [`t${i}`] }));
    const f = generateFacets(wide);
    expect(f.venue).toHaveLength(25);
    expect(f.topics).toHaveLength(25);
    f.venue.forEach(b => expect(b.count).toBe(1));
  });

  it('returns empty buckets for an empty set rather than throwing', () => {
    Object.values(generateFacets([])).forEach(b => expect(b).toEqual([]));
  });
});

describe('a facet is not counted over its own selection', () => {
  // Every facet used to be counted over the fully filtered set, its own ticked
  // values included, so ticking one value emptied the facet of every other. The
  // panel renders what it is given: a second value could be neither seen nor
  // added, and the OR semantics these filters already have were unreachable.
  const corpus = [
    paper({ id: 'a', year: 2021, venue: 'Nature', publisher: 'Springer', topics: ['crispr'] }),
    paper({ id: 'b', year: 2022, venue: 'Science', publisher: 'AAAS', topics: ['crispr'] }),
    paper({ id: 'c', year: 2023, venue: 'Cell', publisher: 'Elsevier', topics: ['genomics'] })
  ];

  const admitted = new Map(corpus.map(p => [p.id, p]));

  const facetsWith = (filters: Parameters<typeof facetBaseSets>[1]) => {
    const bases = facetBaseSets(corpus, filters, {}, admitted);
    const selected = corpus.filter(p => matchesFilters(p, filters));
    return generateFacets(selected, bases);
  };

  it('keeps offering the other years once one is ticked', () => {
    const f = facetsWith({ year: ['2022'] });

    expect(f.year.map(b => b.value).sort()).toEqual([2021, 2022, 2023]);
    // Still one paper each: the count beside a bucket says what selecting it
    // brings in, given everything else the reader has chosen.
    expect(f.year.every(b => b.count === 1)).toBe(true);
  });

  it('keeps offering the other venues, publishers and topics', () => {
    expect(facetsWith({ venue: ['Nature'] }).venue.map(b => b.value).sort())
      .toEqual(['Cell', 'Nature', 'Science']);
    expect(facetsWith({ publisher: ['AAAS'] }).publisher.map(b => b.value).sort())
      .toEqual(['AAAS', 'Elsevier', 'Springer']);
    expect(facetsWith({ topics: ['genomics'] }).topics.map(b => b.value).sort())
      .toEqual(['crispr', 'genomics']);
  });

  it('still narrows one facet by the others', () => {
    // Lifting a facet's own filter must not lift the rest: with 2021 ticked,
    // the venue facet describes 2021 alone.
    const f = facetsWith({ year: ['2021'] });

    expect(f.venue).toEqual([{ value: 'Nature', count: 1 }]);
    expect(f.year.map(b => b.value).sort()).toEqual([2021, 2022, 2023]);
  });

  it('counts a multi-select the way selecting it would return', () => {
    const f = facetsWith({ year: ['2021', '2023'] });

    expect(f.venue.map(b => b.value).sort()).toEqual(['Cell', 'Nature']);
    expect(f.year.find(b => b.value === 2022)).toEqual({ value: 2022, count: 1 });
  });

  it('changes nothing when no filter is ticked', () => {
    // The base sets are only built for facets that have a selection, so an
    // unfiltered search takes exactly the path it always did.
    expect(facetBaseSets(corpus, {}, {}, admitted)).toEqual({});
    expect(facetsWith({})).toEqual(generateFacets(corpus));
  });
});
