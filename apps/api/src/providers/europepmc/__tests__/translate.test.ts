import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query> = {}): Query => ({
  terms: [], phrases: [], join: 'AND', ...over
});

describe('translate', () => {
  it('joins bare terms with AND by default', () => {
    expect(translate(query({ terms: ['crispr', 'editing'] }))).toBe('(crispr AND editing)');
  });

  it('honours an OR join', () => {
    expect(translate(query({ terms: ['crispr', 'talen'], join: 'OR' }))).toBe('(crispr OR talen)');
  });

  it('does not parenthesise a single term', () => {
    expect(translate(query({ terms: ['crispr'] }))).toBe('crispr');
  });

  it('quotes phrases so the words must stay adjacent', () => {
    // The whole reason Query carries structure: a raw string cannot say this,
    // which is why arXiv turns "crispr gene editing" into an OR of three words.
    expect(translate(query({ phrases: ['gene editing'] }))).toBe('"gene editing"');
  });

  it('combines terms and phrases', () => {
    const out = translate(query({ terms: ['crispr'], phrases: ['gene editing'] }));
    expect(out).toBe('crispr AND "gene editing"');
  });

  it('keeps an OR join from swallowing the clauses beside it', () => {
    // `a OR b AND PUB_YEAR:[2020 TO *]` does not mean what it looks like.
    const out = translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2020 } }));
    expect(out).toBe('(a OR b) AND PUB_YEAR:[2020 TO *]');
  });

  it('escapes a quote inside a phrase', () => {
    expect(translate(query({ phrases: ['the "hard" problem'] }))).toBe('"the \\"hard\\" problem"');
  });

  it('builds a DOI lookup and ignores keywords', () => {
    const out = translate(query({ doi: '10.1234/abc', terms: ['ignored'] }));
    expect(out).toBe('DOI:"10.1234/abc"');
  });

  // Range syntax, not comparison operators. Europe PMC accepts `PUB_YEAR:>=n`
  // and silently ignores it, returning the unbounded corpus with an unchanged
  // hit count — after which the orchestrator's own year filter discarded the
  // whole page and a year-bounded search returned nothing.
  it('expresses both year bounds as a range', () => {
    const out = translate(query({ terms: ['x'], years: { from: 2019, to: 2023 } }));
    expect(out).toBe('x AND PUB_YEAR:[2019 TO 2023]');
  });

  it('leaves the open end of a one-sided bound as a wildcard', () => {
    expect(translate(query({ terms: ['x'], years: { to: 2023 } }))).toBe('x AND PUB_YEAR:[* TO 2023]');
    expect(translate(query({ terms: ['x'], years: { from: 2019 } }))).toBe('x AND PUB_YEAR:[2019 TO *]');
  });

  it('emits no year clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'], years: {} }))).toBe('x');
  });

  it('adds the open-access term only when asked', () => {
    // Policy, not a provider constant: the old connector always appended it.
    expect(translate(query({ terms: ['x' ] }))).not.toContain('OPEN_ACCESS');
    expect(translate(query({ terms: ['x'] }), { openAccessOnly: true })).toBe('x AND OPEN_ACCESS:y');
  });

  it('drops blank terms and phrases rather than emitting empty clauses', () => {
    expect(translate(query({ terms: ['crispr', '  '], phrases: [''] }))).toBe('crispr');
  });

  it('returns an empty string for an empty query', () => {
    expect(translate(query())).toBe('');
  });
});
