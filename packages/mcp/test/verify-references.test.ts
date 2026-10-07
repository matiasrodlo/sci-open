import { describe, it, expect, vi } from 'vitest';
import { paper, ref } from '@sci-open/core/testing';
import { verifyReferences } from '../src/tools/verify-references';
import { fakeEngine, type FakeOptions } from './fake-engine';

/**
 * The flagship check, against a small world of real-looking papers: what it
 * calls real, garbled, mismatched and fabricated, and that one refusal never
 * loses a batch.
 */

const ATTENTION = paper({
  id: 'crossref:W2963403868', doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'], year: 2017, stage: 'preprint',
  sources: [ref('crossref'), ref('arxiv', { nativeId: '1706.03762v7' }), ref('core')]
});
const CRISPR = paper({
  id: 'crossref:W2045435533', doi: '10.1126/science.1258096', title: 'The new frontier of genome engineering with CRISPR-Cas9',
  authors: ['Jennifer A. Doudna', 'Emmanuelle Charpentier'], year: 2014, oaStatus: 'closed', fullText: undefined,
  sources: [ref('crossref'), ref('europepmc')]
});
const DNA = paper({
  id: 'europepmc:13054692', doi: '10.1038/171737a0', title: 'Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid',
  authors: ['J. D. Watson', 'F. H. C. Crick'], year: 1953, sources: [ref('europepmc'), ref('crossref')]
});
const DISCHARGE = paper({
  id: 'crossref:W9', doi: '10.1001/jama.2020.1', title: 'Same-day discharge is not inferior to overnight stay',
  authors: ['Maria Rossi'], year: 2020, sources: [ref('crossref')]
});
const WORLD = [ATTENTION, CRISPR, DNA, DISCHARGE];

const verify = async (references: string[], options: FakeOptions = {}) => {
  const fake = fakeEngine(WORLD, options);
  const outcome = await verifyReferences.run({ references }, fake.deps);
  return { ...outcome.structured, text: outcome.text, fake };
};

describe('verify_references', () => {
  it('verifies real references, closed ones included', async () => {
    const { results, summary } = await verify([
      'Vaswani A, Shazeer N, Parmar N. Attention is all you need. Advances in Neural Information Processing Systems. 2017.',
      'Doudna, J. A., & Charpentier, E. (2014). The new frontier of genome engineering with CRISPR-Cas9. Science. https://doi.org/10.1126/science.1258096'
    ]);
    expect(results.map(r => r.verdict)).toEqual(['verified', 'verified']);
    expect(results[0]!.evidence).toMatchObject({ matched_on: 'title', corroborated_by: ['crossref', 'arxiv', 'core'] });
    expect(results[1]!.evidence.matched_on).toBe('doi');
    expect(summary).toMatchObject({ verified: 2, not_found: 0 });
  });

  it('judges cited DOIs on OpenAlex’s records, asked once for the batch, with no search and no admission', async () => {
    const fake = fakeEngine(WORLD);
    const resolveDois = vi.spyOn(fake.engine, 'resolveDois');
    const lookupDoi = vi.spyOn(fake.engine, 'lookupDoi');
    const { structured } = await verifyReferences.run({
      references: [
        'Doudna JA, Charpentier E. The new frontier of genome engineering with CRISPR-Cas9. Science. 2014. doi:10.1126/science.1258096',
        'Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953. https://doi.org/10.1038/171737a0',
        'Doudna JA. The new frontier of genome engineering with CRISPR-Cas9. 2014. doi:10.1126/science.1258096'
      ]
    }, fake.deps);

    expect(structured.results.map(r => r.verdict)).toEqual(['verified', 'likely', 'verified']);
    expect(resolveDois).toHaveBeenCalledTimes(1);
    expect(resolveDois.mock.calls[0]![0]).toEqual(['10.1126/science.1258096', '10.1038/171737a0']);
    expect(lookupDoi).not.toHaveBeenCalled();
    expect(fake.admitted()).toBe(0);
  });

  it('still asks every source about a DOI OpenAlex lacks or could not be asked about', async () => {
    const { results, fake } = await verify(
      ['Doudna JA, Charpentier E. The new frontier of genome engineering with CRISPR-Cas9. Science. 2014. doi:10.1126/science.1258096'],
      { batch: async dois => ({ found: new Map(), unasked: [...dois] }) }
    );
    expect(results[0]).toMatchObject({ verdict: 'verified', evidence: { matched_on: 'doi' } });
    expect(fake.admitted()).toBe(1); // the lookup in every source is a search
  });

  it('finds no paper behind a fabricated title', async () => {
    const { results } = await verify(['Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature. 2021;590:112-118.']);
    expect(results[0]).toMatchObject({ verdict: 'not_found', issues: ['no_similar_title_in_any_source'] });
  });

  it('calls a real DOI on another paper a mismatch, with the paper cited to correct it from and the paper the DOI is on', async () => {
    const { results, text } = await verify(['Doudna JA, Charpentier E. The new frontier of genome engineering with CRISPR-Cas9. Science. 2014. doi:10.1038/171737a0']);
    expect(results[0]).toMatchObject({ verdict: 'mismatch', issues: ['doi_points_to_different_work'], evidence: { matched_on: 'title' } });
    // `matched` is the paper the citation names, whose DOI is the correction;
    // it used to be the DOI's own paper, so "give the matched record's DOI"
    // gave back the wrong one.
    expect(results[0]!.matched?.doi).toBe('10.1126/science.1258096');
    expect(results[0]!.doi_target?.doi).toBe('10.1038/171737a0');
    expect(text).toContain('the cited DOI is that of Molecular structure of nucleic acids');
  });

  it('calls a real DOI on a title no source holds a mismatch, with only the paper the DOI is on', async () => {
    const { results } = await verify(['Okafor L. Quantum annealing of protein folding landscapes. Nature. 2021. doi:10.1038/171737a0']);
    expect(results[0]).toMatchObject({
      verdict: 'mismatch',
      issues: ['doi_points_to_different_work', 'cited_title_not_found'],
      doi_target: { doi: '10.1038/171737a0' }
    });
    expect(results[0]!.matched).toBeUndefined();
  });

  it('calls a DOI on a related paper a mismatch, not a reference that does not exist', async () => {
    // Half the cited title is in the DOI's record: too much to call it a
    // different work by overlap alone, too little to be the paper cited.
    const { results } = await verify(['Rossi M. Same-day discharge is safe in rural hospitals. 2020. doi:10.1001/jama.2020.1']);
    expect(results[0]).toMatchObject({ verdict: 'mismatch', issues: expect.arrayContaining(['doi_points_to_different_work']) });
  });

  describe('a generic title whose original the title search does not return', () => {
    // Measured on the references eval: "A mathematical theory of communication"
    // cited as 1951 matched a 1950 Physics Today item, and the title search
    // returned the original at no rank at all. Made up here, as eval
    // references stay out.
    const original = paper({
      id: 'crossref:10.1000/ssj.1948', doi: '10.1000/ssj.1948', title: 'A mathematical theory of signalling',
      authors: ['C. E. Lindqvist'], year: 1948, venue: 'Signal Systems Journal', biblio: { volume: '27', firstPage: '379' },
      sources: [ref('crossref')]
    });
    const elsewhere = paper({
      ...original, id: 'crossref:10.1000/pl.1950', doi: '10.1000/pl.1950', year: 1950, venue: 'Physics Lately',
      biblio: { volume: '3', firstPage: '31' }
    });
    // Ahead of the original in every answer: the five the judge sees.
    const lookalikes = ['in neurons', 'for networks', 'and its limits', 'revisited'].map((tail, i) => paper({
      id: `crossref:10.1000/look.${i}`, doi: `10.1000/look.${i}`, title: `A mathematical theory of signalling ${tail}`,
      authors: ['Ben Okoro'], year: 2010 + i, sources: [ref('crossref')]
    }));
    const cited = 'Lindqvist CE. A mathematical theory of signalling. Signal Systems Journal. 1951;27(3):379-423.';

    it('looks for the title by the author cited, and finds the original there', async () => {
      const fake = fakeEngine([elsewhere, ...lookalikes, original]);
      const { structured } = await verifyReferences.run({ references: [cited] }, fake.deps);
      expect(structured.results[0]).toMatchObject({
        verdict: 'ambiguous', matched: { doi: '10.1000/ssj.1948' }, issues: ['year_mismatch: cited 1951, record 1948']
      });
      expect(fake.searches).toEqual([
        'TI=(mathematical theory signalling) AND PY=1950-1952',
        'TI=(mathematical theory signalling)',
        'TI=(mathematical theory signalling) AND AU=lindqvist'
      ]);
    });

    it('quotes an author whose name is more than letters', async () => {
      const fake = fakeEngine([]);
      await verifyReferences.run({ references: ['Perdomo-Ortiz A. A study nobody wrote. 2012.'] }, fake.deps);
      expect(fake.searches).toContain('TI=(study nobody wrote) AND AU="perdomo-ortiz"');
    });
  });

  describe('a DOI whose record left the cited subtitle off', () => {
    // Measured live: OpenAlex titles "False-Positive Psychology: Undisclosed
    // Flexibility…" as "False-Positive Psychology", and the correct citation
    // was called a DOI on another paper. Made up here, as eval references stay out.
    const SHORT = paper({
      id: 'crossref:W2011', doi: '10.1000/short.2011', title: 'Threshold Memory',
      authors: ['Ana Lindqvist', 'Ben Okoro'], year: 2011, sources: [ref('crossref')]
    });
    const check = async (reference: string) => (await verifyReferences.run({ references: [reference] }, fakeEngine([SHORT]).deps)).structured.results[0]!;

    it('verifies the citation, by the authors and year it agrees on', async () => {
      const result = await check('Lindqvist A, Okoro B. Threshold memory: emergent recall in sparse networks of noisy units. 2011. doi:10.1000/short.2011');
      expect(result).toMatchObject({ verdict: 'verified', evidence: { matched_on: 'doi', title_precision: 1 } });
    });

    it('still calls it a DOI on another paper when the cited authors are not the record’s', async () => {
      // A short main title is shared by many papers; without the authors it names none of them.
      const result = await check('Brandt K. Threshold memory: a survey of sparse recall. 2011. doi:10.1000/short.2011');
      expect(result).toMatchObject({ verdict: 'mismatch', issues: ['doi_points_to_different_work', 'cited_title_not_found'] });
    });
  });

  it('calls an invented DOI on a real title a mismatch, with the real record to correct it from', async () => {
    const { results } = await verify(['Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature. 1953. doi:10.1038/fake.0001']);
    expect(results[0]).toMatchObject({ verdict: 'mismatch', issues: ['doi_not_registered'], evidence: { matched_on: 'title' } });
    expect(results[0]!.matched?.doi).toBe('10.1038/171737a0');
  });

  it('calls an invented DOI with nothing real behind it not found', async () => {
    const { results } = await verify(['Okafor L. Quantum annealing of folding landscapes. Nature. 2021. doi:10.9999/invented']);
    expect(results[0]).toMatchObject({ verdict: 'not_found', issues: ['doi_not_registered', 'no_similar_title_in_any_source'] });
  });

  it('calls a year three off ambiguous, and says which', async () => {
    const { results } = await verify(['Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature 1956;171:737-738.']);
    expect(results[0]).toMatchObject({ verdict: 'ambiguous', issues: ['year_mismatch: cited 1956, record 1953'] });
  });

  it('searches a title holding "not" without it, which the grammar leaves out, and "same" as the word it is', async () => {
    // Every query also goes through the real grammar in the fake engine.
    const { results, fake } = await verify(['Rossi M. Same day discharge is not inferior to overnight stay. JAMA. 2020.']);
    expect(results[0]!.verdict).toBe('verified');
    expect(fake.searches).toEqual(['TI=(same day discharge is inferior overnight stay) AND PY=2019-2021']);
  });

  it('ignores the punctuation sources disagree on', async () => {
    // Cited with a colon; the record, as Europe PMC titles it, has a semicolon.
    const { results } = await verify(['Watson JD, Crick FHC. Molecular structure of nucleic acids; a structure for deoxyribose nucleic acid. Nature. 1953.']);
    expect(results[0]).toMatchObject({ verdict: 'verified', matched: { doi: '10.1038/171737a0' } });
  });

  it('reads only the top of each source for a title, which is all it judges', async () => {
    const fake = fakeEngine(WORLD);
    const search = vi.spyOn(fake.engine, 'search');
    await verifyReferences.run({ references: ['Vaswani A, et al. Attention is all you need. NeurIPS. 2017.'] }, fake.deps);
    expect(search).toHaveBeenCalled();
    expect(search.mock.calls.every(([, options]) => options?.depth === 25)).toBe(true);
  });

  it('spends two searches on a wrong year, not three', async () => {
    const { results, fake } = await verify(['Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature 1956.']);
    expect(results[0]!.verdict).toBe('ambiguous');
    expect(fake.searches).toHaveLength(2);
  });

  it('finds the original of a paper reprinted under its own title, by the year cited', async () => {
    // Measured live: the 1953 paper's title search ranked a 2007 reprint above it.
    const reprint = paper({ ...DNA, id: 'crossref:W2007', doi: '10.1097/blo.0b013e31814b9304', year: 2007, authors: ['J. D. Watson', 'F. H. C. Crick'] });
    const fake = fakeEngine([reprint, DNA]);
    const { structured } = await verifyReferences.run({
      references: ['Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature. 1953;171:737-738.']
    }, fake.deps);
    expect(structured.results[0]).toMatchObject({ verdict: 'verified', matched: { doi: '10.1038/171737a0' } });
    expect(fake.searches).toHaveLength(1);
  });

  describe('a paper reprinted under its own title in another venue and year', () => {
    // Made up, so that no eval reference becomes a test case.
    const original = paper({
      id: 'crossref:W1979', doi: '10.1000/jtp.1979.301', title: 'Emergent memory in networks of threshold units',
      authors: ['A. Lindqvist'], year: 1979, venue: 'Journal of Theoretical Physics', biblio: { volume: '12', firstPage: '301' },
      sources: [ref('crossref'), ref('europepmc')]
    });
    const reprint = paper({
      ...original, id: 'crossref:W1984', doi: '10.1000/lnp.1984.45', year: 1984, venue: 'Lecture notes in physics',
      biblio: { firstPage: '45' }, sources: [ref('crossref')]
    });
    const check = async (reference: string) => {
      const fake = fakeEngine([reprint, original]);
      const { structured } = await verifyReferences.run({ references: [reference] }, fake.deps);
      return { result: structured.results[0]!, searches: fake.searches };
    };

    it('is matched to the original when cited with the reprint’s year, by the journal, volume and page cited', async () => {
      // Measured live: a 1982 paper cited as 1986 was matched to its 1986
      // reprint in a book series, and called likely rather than ambiguous.
      const { result, searches } = await check('Lindqvist A. Emergent memory in networks of threshold units. J Theor Phys. 1984;12(3):301-310.');
      expect(result).toMatchObject({ verdict: 'ambiguous', matched: { doi: '10.1000/jtp.1979.301' }, issues: ['year_mismatch: cited 1984, record 1979'] });
      expect(searches).toHaveLength(2);
    });

    it('is matched to the reprint when cited as the reprint', async () => {
      const { result, searches } = await check(
        'Lindqvist A. Emergent memory in networks of threshold units. In: Lecture Notes in Physics. Berlin: Springer; 1984. p. 45-52.'
      );
      expect(result).toMatchObject({ verdict: 'verified', matched: { doi: '10.1000/lnp.1984.45' } });
      expect(searches).toHaveLength(1);
    });

    it('is matched to the original when the original is cited', async () => {
      const { result } = await check('Lindqvist A. Emergent memory in networks of threshold units. J Theor Phys. 1979;12(3):301-310.');
      expect(result).toMatchObject({ verdict: 'verified', matched: { doi: '10.1000/jtp.1979.301' } });
    });
  });

  it('never calls a registered DOI no source indexes unregistered', async () => {
    const { results } = await verify(['doi:10.48550/arXiv.2401.99999'], { registered: ['10.48550/arXiv.2401.99999'] });
    expect(results[0]).toMatchObject({ verdict: 'ambiguous', issues: ['doi_registered_but_not_indexed'] });
  });

  it('says so when the DOI registry could not be asked', async () => {
    const { results } = await verify(['doi:10.1234/unknown'], { registered: null });
    expect(results[0]).toMatchObject({ verdict: 'ambiguous', issues: ['doi_unconfirmed: the DOI registry did not answer'] });
  });

  it('looks an arXiv id up by id, any version', async () => {
    const { results } = await verify(['arXiv:1706.03762']);
    expect(results[0]).toMatchObject({ verdict: 'verified', evidence: { matched_on: 'arxiv' } });
  });

  it('keeps every verdict it reached when the search budget runs out, and marks the rest not checked', async () => {
    const { results, summary, text } = await verify([
      'Vaswani A. Attention is all you need. 2017.',
      'Rossi M. Same-day discharge is not inferior to overnight stay. 2020.',
      'Okafor L. Quantum annealing of protein folding landscapes. 2021.'
    ], { admissions: 1 });
    expect(results.map(r => r.verdict)).toEqual(['verified', 'not_checked', 'not_checked']);
    expect(results[1]!.issues).toEqual(['rate_limited: retry in 42 s']);
    expect(summary.not_checked).toBe(2);
    expect(text).toContain('not checked 2 (send those again later)');
  });

  it('fences the matched records', async () => {
    const { text } = await verify(['Vaswani A. Attention is all you need. 2017.']);
    expect(text).toMatch(/^<untrusted-[0-9a-f-]{36}>$/m);
  });
});
