import { describe, it, expect } from 'vitest';
import { facetBaseSets, facetKey, generateFacets, withSourceCounts } from '../facet';
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

  it('drops years after the current one, and lists the paper still', () => {
    const dated = [...papers, paper({ id: 'd', year: 2035 }), paper({ id: 'e', year: 2027 }), paper({ id: 'f', year: 2026 })];
    const f = generateFacets(dated, {}, new Date('2026-09-25T00:00:00Z'));
    expect(f.year.map(b => b.value)).toEqual([2026, 2021, 2020]);
    expect(f.source[0]!.count).toBe(dated.length);
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

describe('facetKey', () => {
  it('ignores case, accents, punctuation and the spelling of "and"', () => {
    expect(facetKey('Frontiers in psychology')).toBe(facetKey('Frontiers in Psychology'));
    expect(facetKey('Taylor & Francis')).toBe(facetKey('Taylor and Francis'));
    expect(facetKey('Revista Médica de Chile')).toBe(facetKey('Revista medica de chile'));
    expect(facetKey('PLoS ONE')).toBe(facetKey('PLOS ONE'));
  });

  it('keeps different names different', () => {
    expect(facetKey('Nature')).not.toBe(facetKey('Nature Communications'));
  });
});

describe('generateFacets — spellings', () => {
  it('counts every spelling of a venue in one bucket, labelled as most papers spell it', () => {
    const f = generateFacets([
      paper({ id: 'a', venue: 'Frontiers in Psychology' }),
      paper({ id: 'b', venue: 'Frontiers in psychology' }),
      paper({ id: 'c', venue: 'Frontiers in Psychology' })
    ]);

    expect(f.venue).toEqual([{ value: 'Frontiers in Psychology', count: 3 }]);
  });

  it('counts a paper once for a topic it carries in two spellings', () => {
    expect(generateFacets([paper({ topics: ['CRISPR', 'crispr'] })]).topics).toEqual([{ value: 'CRISPR', count: 1 }]);
  });
});

/**
 * The read counts the top of each source's answer; the sources count all of
 * it. The two meet here, and the rule is the largest single count — never the
 * sum, because the sources hold the same papers several times over.
 */
describe('withSourceCounts', () => {
  const read = generateFacets([
    paper({ id: 'a', year: 2024, venue: 'Frontiers in psychology' }),
    paper({ id: 'b', year: 2023, venue: 'Nature' })
  ]);

  it('takes the largest single source’s count, and names it', () => {
    const f = withSourceCounts(read, [
      { provider: 'openalex', facets: { year: [{ value: 2024, count: 900 }] } },
      { provider: 'europepmc', facets: { year: [{ value: 2024, count: 400 }, { value: 2023, count: 50 }] } }
    ], ['year']);

    expect(f.year).toEqual([
      { value: 2024, count: 900, from: 'openalex' },
      { value: 2023, count: 50, from: 'europepmc' }
    ]);
  });

  it('drops a future year a source reports', () => {
    // OpenAlex's `group_by` answers every year it holds, whatever was asked.
    const f = withSourceCounts(read, [
      { provider: 'openalex', facets: { year: [{ value: 2035, count: 2 }, { value: 2024, count: 900 }] } }
    ], ['year'], new Date('2026-09-25T00:00:00Z'));

    expect(f.year.map(b => b.value)).toEqual([2024, 2023]);
  });

  it('keeps the read’s count where it is larger', () => {
    const f = withSourceCounts(read, [{ provider: 'plos', facets: { year: [{ value: 2023, count: 0 }] } }], ['year']);
    expect(f.year.find(b => b.value === 2023)).toEqual({ value: 2023, count: 1 });
  });

  it('meets a source’s spelling with the read’s, and keeps the read’s', () => {
    // So ticking it finds the papers the list holds.
    const f = withSourceCounts(read, [
      { provider: 'openalex', facets: { venue: [{ value: 'Frontiers in Psychology', count: 210 }] } }
    ], ['venue']);

    expect(f.venue[0]).toEqual({ value: 'Frontiers in psychology', count: 210, from: 'openalex' });
  });

  it('adds a value only a source holds', () => {
    const f = withSourceCounts(read, [
      { provider: 'openalex', facets: { venue: [{ value: 'Malaria Journal', count: 608 }] } }
    ], ['venue']);

    expect(f.venue.map(b => b.value)).toEqual(['Malaria Journal', 'Frontiers in psychology', 'Nature']);
  });

  it('leaves a facet it was not told to count as the read counted it', () => {
    const f = withSourceCounts(read, [
      { provider: 'openalex', facets: { venue: [{ value: 'Nature', count: 5000 }] } }
    ], ['year']);

    expect(f.venue).toEqual(read.venue);
  });
});
