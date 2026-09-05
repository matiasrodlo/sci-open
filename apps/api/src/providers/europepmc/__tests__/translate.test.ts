import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query> = {}): Query => ({
  terms: [], phrases: [], join: 'AND', ...over
});

describe('translate', () => {
  it('joins bare terms with AND by default', () => {
    expect(translate(query({ terms: ['crispr', 'editing'] })))
      .toBe('((TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) AND (TITLE_ABS:editing OR MESH:editing OR KW:editing))');
  });

  it('honours an OR join', () => {
    expect(translate(query({ terms: ['crispr', 'talen'], join: 'OR' })))
      .toBe('((TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) OR (TITLE_ABS:talen OR MESH:talen OR KW:talen))');
  });

  it('does not parenthesise a single term', () => {
    expect(translate(query({ terms: ['crispr'] }))).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr)');
  });

  it('quotes phrases so the words must stay adjacent', () => {
    // The whole reason Query carries structure: a raw string cannot say this,
    // which is why arXiv turns "crispr gene editing" into an OR of three words.
    expect(translate(query({ phrases: ['gene editing'] })))
      .toBe('(TITLE_ABS:"gene editing" OR MESH:"gene editing" OR KW:"gene editing")');
  });

  it('combines terms and phrases', () => {
    const out = translate(query({ terms: ['crispr'], phrases: ['gene editing'] }));
    expect(out).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) AND (TITLE_ABS:"gene editing" OR MESH:"gene editing" OR KW:"gene editing")');
  });

  it('keeps an OR join from swallowing the clauses beside it', () => {
    // `a OR b AND PUB_YEAR:[2020 TO *]` does not mean what it looks like.
    const out = translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2020 } }));
    expect(out).toBe('((TITLE_ABS:a OR MESH:a OR KW:a) OR (TITLE_ABS:b OR MESH:b OR KW:b)) AND PUB_YEAR:[2020 TO *]');
  });

  it('escapes a quote inside a phrase', () => {
    expect(translate(query({ phrases: ['the "hard" problem'] })))
      .toBe('(TITLE_ABS:"the \\"hard\\" problem" OR MESH:"the \\"hard\\" problem" OR KW:"the \\"hard\\" problem")');
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
    expect(out).toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[2019 TO 2023]');
  });

  it('leaves the open end of a one-sided bound as a wildcard', () => {
    expect(translate(query({ terms: ['x'], years: { to: 2023 } })))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[* TO 2023]');
    expect(translate(query({ terms: ['x'], years: { from: 2019 } })))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[2019 TO *]');
  });

  it('emits no year clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'], years: {} }))).toBe('(TITLE_ABS:x OR MESH:x OR KW:x)');
  });

  it('adds the open-access term only when asked', () => {
    // Policy, not a provider constant: the old connector always appended it.
    expect(translate(query({ terms: ['x' ] }))).not.toContain('OPEN_ACCESS');
    expect(translate(query({ terms: ['x'] }), { openAccessOnly: true }))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND OPEN_ACCESS:y');
  });

  it('drops blank terms and phrases rather than emitting empty clauses', () => {
    expect(translate(query({ terms: ['crispr', '  '], phrases: [''] }))).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr)');
  });

  it('returns an empty string for an empty query', () => {
    expect(translate(query())).toBe('');
  });
});

/**
 * Unscoped, Europe PMC searches everything it indexes, and that number sat in
 * the panel beside DOAJ's title/abstract/keywords figure as though the two
 * asked the same question. Measured with `OPEN_ACCESS:y`: `ai` matches
 * **521,177** unscoped and **54,005** in `TITLE_ABS`.
 *
 * `MESH` and `KW` are in the scope because here they are not a rounding error:
 * `crispr` matches 31,567 in `TITLE_ABS` alone and **34,916** with the two
 * beside it.
 */
describe('translate — the scope of the search', () => {
  it('searches the title, abstract, MeSH headings and keywords', () => {
    expect(translate(query({ terms: ['ai'] })))
      .toBe('(TITLE_ABS:ai OR MESH:ai OR KW:ai)');
  });

  it('gives every term its own prefix, because a prefix binds one token', () => {
    // `TITLE_ABS:gene editing` scopes `gene` and leaves `editing` loose across
    // the whole index: 220,538 matches where the quoted phrase has 7,740.
    const out = translate(query({ terms: ['gene', 'editing'] }));
    expect(out).toBe(
      '((TITLE_ABS:gene OR MESH:gene OR KW:gene) AND (TITLE_ABS:editing OR MESH:editing OR KW:editing))'
    );
  });

  it('leaves a DOI lookup unscoped, since a DOI is in none of the four', () => {
    expect(translate(query({ doi: '10.1/x' }))).toBe('DOI:"10.1/x"');
  });
});
