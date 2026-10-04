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
  id: 'openalex:W2963403868', doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'], year: 2017, stage: 'preprint',
  sources: [ref('openalex'), ref('arxiv', { nativeId: '1706.03762v7' }), ref('core')]
});
const CRISPR = paper({
  id: 'openalex:W2045435533', doi: '10.1126/science.1258096', title: 'The new frontier of genome engineering with CRISPR-Cas9',
  authors: ['Jennifer A. Doudna', 'Emmanuelle Charpentier'], year: 2014, oaStatus: 'closed', fullText: undefined,
  sources: [ref('openalex'), ref('europepmc')]
});
const DNA = paper({
  id: 'europepmc:13054692', doi: '10.1038/171737a0', title: 'Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid',
  authors: ['J. D. Watson', 'F. H. C. Crick'], year: 1953, sources: [ref('europepmc'), ref('openalex')]
});
const DISCHARGE = paper({
  id: 'openalex:W9', doi: '10.1001/jama.2020.1', title: 'Same-day discharge is not inferior to overnight stay',
  authors: ['Maria Rossi'], year: 2020, sources: [ref('openalex')]
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
    expect(results[0]!.evidence).toMatchObject({ matched_on: 'title', corroborated_by: ['openalex', 'arxiv', 'core'] });
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
      { openalex: async dois => ({ found: new Map(), unasked: [...dois] }) }
    );
    expect(results[0]).toMatchObject({ verdict: 'verified', evidence: { matched_on: 'doi' } });
    expect(fake.admitted()).toBe(1); // the lookup in every source is a search
  });

  it('finds no paper behind a fabricated title', async () => {
    const { results } = await verify(['Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature. 2021;590:112-118.']);
    expect(results[0]).toMatchObject({ verdict: 'not_found', issues: ['no_similar_title_in_any_source'] });
  });

  it('calls a real DOI on another paper a mismatch, and shows the paper it is on', async () => {
    const { results } = await verify(['Doudna JA, Charpentier E. The new frontier of genome engineering with CRISPR-Cas9. Science. 2014. doi:10.1038/171737a0']);
    expect(results[0]).toMatchObject({ verdict: 'mismatch', issues: expect.arrayContaining(['doi_points_to_different_work']) });
    expect(results[0]!.matched?.doi).toBe('10.1038/171737a0');
  });

  it('calls a DOI on a related paper a mismatch, not a reference that does not exist', async () => {
    // Half the cited title is in the DOI's record: too much to call it a
    // different work by overlap alone, too little to be the paper cited.
    const { results } = await verify(['Rossi M. Same-day discharge is safe in rural hospitals. 2020. doi:10.1001/jama.2020.1']);
    expect(results[0]).toMatchObject({ verdict: 'mismatch', issues: expect.arrayContaining(['doi_points_to_different_work']) });
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

  it('searches a title holding "not" and "same" without them, which the grammar reads as operators', async () => {
    // Every query also goes through the real grammar in the fake engine.
    const { results, fake } = await verify(['Rossi M. Same day discharge is not inferior to overnight stay. JAMA. 2020.']);
    expect(results[0]!.verdict).toBe('verified');
    expect(fake.searches).toEqual(['TI=(day discharge is inferior overnight stay) AND PY=2019-2021']);
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
    const reprint = paper({ ...DNA, id: 'openalex:W2007', doi: '10.1097/blo.0b013e31814b9304', year: 2007, authors: ['J. D. Watson', 'F. H. C. Crick'] });
    const fake = fakeEngine([reprint, DNA]);
    const { structured } = await verifyReferences.run({
      references: ['Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature. 1953;171:737-738.']
    }, fake.deps);
    expect(structured.results[0]).toMatchObject({ verdict: 'verified', matched: { doi: '10.1038/171737a0' } });
    expect(fake.searches).toHaveLength(1);
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
