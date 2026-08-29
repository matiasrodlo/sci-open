import { describe, it, expect } from 'vitest';
import { parseQuery } from '../parse-query';

describe('parseQuery', () => {
  it('splits bare words into terms', () => {
    expect(parseQuery('crispr gene editing')).toEqual({
      terms: ['crispr', 'gene', 'editing'], phrases: [], join: 'AND'
    });
  });

  it('keeps a quoted run as one phrase', () => {
    expect(parseQuery('"gene editing"')).toEqual({
      terms: [], phrases: ['gene editing'], join: 'AND'
    });
  });

  it('does not also emit a phrase\'s words as terms', () => {
    expect(parseQuery('crispr "gene editing"')).toEqual({
      terms: ['crispr'], phrases: ['gene editing'], join: 'AND'
    });
  });

  it('handles several phrases', () => {
    const q = parseQuery('"gene editing" and "base editing"');
    expect(q.phrases).toEqual(['gene editing', 'base editing']);
    expect(q.terms).toEqual(['and']);
  });

  it('leaves an unclosed quote alone rather than swallowing the query', () => {
    const q = parseQuery('crispr "gene editing');
    expect(q.phrases).toEqual([]);
    expect(q.terms).toEqual(['crispr', '"gene', 'editing']);
  });

  it('recognises a bare DOI', () => {
    expect(parseQuery('10.1038/s41586-020-2649-2')).toEqual({
      terms: [], phrases: [], join: 'AND', doi: '10.1038/s41586-020-2649-2'
    });
  });

  it('recognises a doi.org URL', () => {
    expect(parseQuery('https://doi.org/10.1038/nature12373').doi).toBe('10.1038/nature12373');
  });

  it('does not mistake a sentence containing a DOI for a DOI lookup', () => {
    expect(parseQuery('see 10.1038/nature12373 for details').doi).toBeUndefined();
  });

  it('carries the requested join and year bounds', () => {
    const q = parseQuery('a b', { join: 'OR', years: { from: 2020, to: 2023 } });
    expect(q.join).toBe('OR');
    expect(q.years).toEqual({ from: 2020, to: 2023 });
  });

  it('returns an empty query for empty input', () => {
    expect(parseQuery('   ')).toEqual({ terms: [], phrases: [], join: 'AND' });
  });
});
