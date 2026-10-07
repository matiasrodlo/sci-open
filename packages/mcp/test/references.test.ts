import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseReference } from '../src/references/parse';
import { citedPlace, judge, surnameIn, titleOverlap, venueConsistent } from '../src/references/match';
import { paper, ref } from '@sci-open/core/testing';

type Case = {
  style: string;
  raw: string;
  expect: { doi?: string; arxiv?: string; pmid?: string; year?: number; title?: string; surnames: string[] };
};

const { cases } = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'references.json'), 'utf8')) as { cases: Case[] };

describe('parseReference', () => {
  it.each(cases.map(c => [c.style, c] as const))('%s', (_style, c) => {
    const parsed = parseReference(c.raw);
    expect(parsed.doi).toBe(c.expect.doi);
    expect(parsed.arxiv).toBe(c.expect.arxiv);
    expect(parsed.pmid).toBe(c.expect.pmid);
    expect(parsed.year).toBe(c.expect.year);
    expect(parsed.title).toBe(c.expect.title);
    expect(parsed.surnames).toEqual(expect.arrayContaining(c.expect.surnames));
    if (c.expect.surnames.length === 0) expect(parsed.surnames).toEqual([]);
  });

  it('names no authors when it cannot tell where they end', () => {
    // A surname guessed from a title would be an author mismatch against the real paper.
    expect(parseReference('Deep Residual Learning for Image Recognition 2016').surnames).toEqual([]);
  });
});

describe('titleOverlap', () => {
  it('ignores case, accents, punctuation and stop words', () => {
    expect(titleOverlap('The Structure of Scientific Revolutions', 'structure of scientific revolutions')).toEqual({ precision: 1, recall: 1 });
    expect(titleOverlap('Café culture', 'Cafe Culture!')).toEqual({ precision: 1, recall: 1 });
  });

  it('says how much of each title the other holds', () => {
    const { precision, recall } = titleOverlap('attention is all you need', 'attention is all you need for translation');
    expect(precision).toBe(1);
    expect(recall).toBeLessThan(1);
  });
});

describe('judge', () => {
  const record = paper({
    id: 'crossref:W1',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    sources: [ref('crossref'), ref('arxiv'), ref('core')]
  });

  it('verifies a matching title, year and author, and counts the sources behind it', () => {
    const j = judge(parseReference('Vaswani A, Shazeer N. Attention is all you need. NeurIPS. 2017.'), record);
    expect(j.verdict).toBe('verified');
    expect(j.corroborated_by).toEqual(['crossref', 'arxiv', 'core']);
    expect(j.issues).toEqual([]);
  });

  it('calls a year three off ambiguous, and says so', () => {
    const j = judge(parseReference('Vaswani A, Shazeer N. Attention is all you need. NeurIPS. 2020.'), record);
    expect(j.verdict).toBe('ambiguous');
    expect(j.issues).toEqual(['year_mismatch: cited 2020, record 2017']);
  });

  it('matches authors across accents', () => {
    const accented = paper({ title: 'Ice sheet dynamics under warming scenarios', authors: ['Karl Muller'], year: 2020 });
    const j = judge(parseReference('Müller, K. (2020). Ice sheet dynamics under warming scenarios. J Glaciol.'), accented);
    expect(j.author_consistent).toBe(true);
    expect(j.verdict).toBe('verified');
  });

  it('finds nothing behind a partial title when the year and the authors both disagree', () => {
    // Measured live: three of five title words shared, eleven years and every author apart.
    const near = paper({
      title: 'Finding low-energy conformations of lattice protein models by quantum annealing',
      authors: ['Alejandro Perdomo-Ortiz'], year: 2012
    });
    const cited = parseReference('Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature 2021;590:112-118.');
    expect(judge(cited, near).verdict).toBe('not_found');
    // The same overlap with only the year wrong is still worth a look.
    expect(judge({ ...cited, surnames: ['perdomo'] }, near).verdict).toBe('ambiguous');
  });

  it('finds nothing behind four title words in five when the year and the authors both disagree', () => {
    // Measured live once Crossref was searched: closer than the 2012 paper,
    // and by other authors and in another year all the same.
    const closer = paper({ title: 'Exploring quantum annealing for coarse-grained protein folding', authors: ['Ana Lindqvist'], year: 2025 });
    const cited = parseReference('Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature 2021;590:112-118.');
    expect(judge(cited, closer).verdict).toBe('not_found');
    // The whole title, under other names and another year, is still worth a look.
    const same = paper({ title: 'Quantum annealing of protein folding landscapes', authors: ['Ana Lindqvist'], year: 2025 });
    expect(judge(cited, same).verdict).toBe('ambiguous');
  });

  it('finds nothing in a title that shares little', () => {
    const j = judge(parseReference('Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature. 2021.'), record);
    expect(j.verdict).toBe('not_found');
  });

  it('verifies a reference that is an identifier alone', () => {
    expect(judge(parseReference('arXiv:1706.03762'), record).verdict).toBe('verified');
  });

  it('does not take a short surname inside a longer name for an author', () => {
    // "li" is inside "Illia Polosukhin" and "ma" inside "Niki Parmar": a real
    // title cited under someone else's name was verified as theirs.
    const full = paper({ ...record, authors: ['Ashish Vaswani', 'Niki Parmar', 'Llion Jones', 'Illia Polosukhin'] });
    for (const text of ['Li, X. (2017). Attention is all you need.', 'Ma, Y., & Lee, K. (2017). Attention is all you need.']) {
      const j = judge(parseReference(text), full);
      expect(j.author_consistent, text).toBe(false);
      expect(j.verdict, text).toBe('ambiguous');
    }
  });

  it('calls a real paper cited in the wrong journal likely, and says which journal it is in', () => {
    const published = paper({ ...record, venue: 'Neural Information Processing Systems' });
    const j = judge(parseReference('Vaswani, A., Shazeer, N. (2017). Attention is all you need. Nature, 550(7676), 354-359.'), published);
    expect(j.verdict).toBe('likely');
    expect(j.venue_consistent).toBe(false);
    expect(j.issues).toEqual(['venue_mismatch: the citation does not name the record\'s venue, Neural Information Processing Systems']);
    // Named right, it is verified.
    expect(judge(parseReference('Vaswani A, Shazeer N. Attention is all you need. Adv Neural Inf Process Syst. 2017;30.'), published).verdict).toBe('verified');
  });

  it('says what a partial title match leaves out', () => {
    const j = judge(parseReference('Vaswani A, Shazeer N. Attention is all you need for translation. 2017.'), record);
    expect(j.issues).toContain('title_partial_match: the cited title and the record\'s share 83% of the cited words');
  });
});

describe('surnameIn', () => {
  it('matches whole names, hyphenated parts and accents, and nothing inside a word', () => {
    expect(surnameIn('perdomo', ['Alejandro Perdomo-Ortiz'])).toBe(true);
    expect(surnameIn('Perdomo-Ortiz', ['Alejandro Perdomo Ortiz'])).toBe(true);
    expect(surnameIn("o'brien", ['Kevin OBrien'])).toBe(true);
    expect(surnameIn('lukasz', ['Łukasz Kaiser'])).toBe(true);
    expect(surnameIn('li', ['Illia Polosukhin', 'Llion Jones'])).toBe(false);
    expect(surnameIn('li', ['Fei-Fei Li'])).toBe(true);
    expect(surnameIn('smith', ['Jane Smithson'])).toBe(false);
  });
});

describe('venueConsistent', () => {
  const withVenue = (venue: string) => paper({ title: 'A title', venue });
  const cited = (journal: string) => parseReference(`Doe J, Roe R. A title. ${journal}. 2020;12(3):45-67.`);

  it.each([
    ['N Engl J Med', 'New England Journal of Medicine'],
    ['Proc Natl Acad Sci U S A', 'Proceedings of the National Academy of Sciences'],
    ['J R Stat Soc Series B', 'Journal of the Royal Statistical Society Series B (Statistical Methodology)'],
    ['Phys. Rev. B', 'Physical review. B, Condensed matter'],
    ['J. Am. Chem. Soc.', 'Journal of the American Chemical Society'],
    ['Nat Methods', 'Nature Methods'],
    ['Rev. Mod. Phys.', 'Reviews of Modern Physics'],
    ['Lancet Glob Health', 'The Lancet Global Health'],
    ['Commun. ACM', 'Communications of the ACM'],
    ['IEEE Trans. Pattern Anal. Mach. Intell.', 'IEEE Transactions on Pattern Analysis and Machine Intelligence'],
    ['JAMA', 'Journal of the American Medical Association'],
    ['CVPR', '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'],
    ['Astron. J.', 'The Astronomical Journal']
  ])('reads %s as %s', (journal, venue) => {
    expect(venueConsistent(cited(journal), withVenue(venue))).toBe(true);
  });

  it.each([
    ['Nature', 'Nature Communications'],
    ['Nature', 'Neural Information Processing Systems'],
    ['Lancet', 'The Lancet Global Health'],
    ['Science', 'Science Advances'],
    ['Cell', 'Molecular Cell']
  ])('does not read %s as %s', (journal, venue) => {
    expect(venueConsistent(cited(journal), withVenue(venue))).toBe(false);
  });

  it('judges nothing when the citation names no venue, or the record names a host', () => {
    expect(venueConsistent(parseReference('Doe J, Roe R. A title. 2020.'), withVenue('Nature'))).toBeUndefined();
    expect(venueConsistent(cited('NeurIPS'), withVenue('arXiv (Cornell University)'))).toBeUndefined();
  });
});

describe('citedPlace', () => {
  it.each([
    ['Vancouver', 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-444.', '521', '436'],
    ['APA', 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444.', '521', '436'],
    ['Nature', 'LeCun, Y., Bengio, Y. & Hinton, G. Deep learning. Nature 521, 436–444 (2015).', '521', '436'],
    ['Chicago', 'LeCun, Yann, Yoshua Bengio, and Geoffrey Hinton. 2015. "Deep Learning." Nature 521 (7553): 436–44.', '521', '436'],
    ['IEEE', 'Y. LeCun, Y. Bengio, and G. Hinton, "Deep learning," Nature, vol. 521, no. 7553, pp. 436–444, 2015.', '521', '436'],
    ['article number', 'Becke AD. A new mixing. J. Chem. Phys. vol. 132, no. 15, Art. no. 154104, 2014.', '132', '154104'],
    ['lettered article number', 'Doe J. A trial. Sci Transl Med. 2021;13(588):eabc1234.', '13', 'eabc1234']
  ])('reads the volume and first page of a %s citation', (_style, text, volume, firstPage) => {
    expect(citedPlace(parseReference(text))).toEqual({ volume, firstPage });
  });

  it('reads nothing from a citation that gives neither', () => {
    expect(citedPlace(parseReference('Vaswani A, Shazeer N. Attention is all you need. NeurIPS. 2017.'))).toEqual({});
  });
});

describe('judge — volume and pages', () => {
  const nature = paper({
    title: 'Deep learning', authors: ['Yann LeCun', 'Yoshua Bengio', 'Geoffrey Hinton'], year: 2015, venue: 'Nature',
    biblio: { volume: '521', issue: '7553', firstPage: '436', lastPage: '444' }
  });

  it('verifies a citation whose volume and pages are the record\'s', () => {
    const j = judge(parseReference('LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-444.'), nature);
    expect(j).toMatchObject({ verdict: 'verified', volume_consistent: true, pages_consistent: true });
  });

  it('calls a real paper cited with the wrong volume and pages likely, and says which', () => {
    const j = judge(parseReference('LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;550(7676):354-359.'), nature);
    expect(j.verdict).toBe('likely');
    expect(j.issues).toEqual(['volume_mismatch: cited 550, record 521', 'pages_mismatch: cited from 354, record from 436']);
  });
});
