import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseReference } from '../src/references/parse';
import { judge, titleOverlap } from '../src/references/match';
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
    id: 'openalex:W1',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    sources: [ref('openalex'), ref('arxiv'), ref('core')]
  });

  it('verifies a matching title, year and author, and counts the sources behind it', () => {
    const j = judge(parseReference('Vaswani A, Shazeer N. Attention is all you need. NeurIPS. 2017.'), record);
    expect(j.verdict).toBe('verified');
    expect(j.corroborated_by).toEqual(['openalex', 'arxiv', 'core']);
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

  it('finds nothing in a title that shares little', () => {
    const j = judge(parseReference('Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature. 2021.'), record);
    expect(j.verdict).toBe('not_found');
  });

  it('verifies a reference that is an identifier alone', () => {
    expect(judge(parseReference('arXiv:1706.03762'), record).verdict).toBe('verified');
  });
});
