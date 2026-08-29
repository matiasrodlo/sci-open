import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });
const ANY = (v: string) =>
  `(bibjson.title:${v} OR bibjson.abstract:${v} OR bibjson.keywords:${v})`;

describe('translate — the field names that silently return nothing', () => {
  // DOAJ accepts a field it does not know and answers HTTP 200 with zero
  // results. Measured: `keywords:crispr` returns 0 against 8,467 for
  // `bibjson.keywords:crispr`, and `year:2022` returns 0 against 1,153,036.
  // The old connector used both dead spellings.
  it('qualifies every field with bibjson', () => {
    const out = translate(query({ terms: ['crispr'] }));
    expect(out).toBe(ANY('crispr'));
    expect(out).not.toMatch(/(^|[^.])\bkeywords:/);
  });

  it('qualifies the year field too', () => {
    const out = translate(query({ terms: ['x'], years: { from: 2022, to: 2023 } }));
    expect(out).toContain('bibjson.year:[2022 TO 2023]');
  });
});

describe('translate — precedence and joins', () => {
  it('searches every term across every field', () => {
    const out = translate(query({ terms: ['crispr', 'gene'] }));
    expect(out).toBe(`(${ANY('crispr')} AND ${ANY('gene')})`);
  });

  it('brackets the term group so a year clause cannot bind to one field', () => {
    // The old connector emitted `title:x OR abstract:x OR keywords:x AND
    // (years)`, where the AND binds to the last clause alone.
    const out = translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2022, to: 2023 } }));
    expect(out).toBe(`(${ANY('a')} OR ${ANY('b')}) AND bibjson.year:[2022 TO 2023]`);
  });

  it('requires a phrase even when the terms are joined with OR', () => {
    const out = translate(query({ terms: ['a', 'b'], phrases: ['gene editing'], join: 'OR' }));
    expect(out).toBe(`(${ANY('a')} OR ${ANY('b')}) AND ${ANY('"gene editing"')}`);
  });
});

describe('translate — year bounds', () => {
  it('never emits a wildcard endpoint', () => {
    // DOAJ answers `bibjson.year:[2024 TO *]` with HTTP 400, and the old
    // connector's whole year clause was built that way — so any year filter
    // made DOAJ drop out of the search entirely and silently.
    for (const years of [{ from: 2022, to: 2023 }, { from: 2024 }, { to: 2021 }]) {
      expect(translate(query({ terms: ['x'], years }))).not.toContain('*');
    }
  });

  it('joins the bounds with AND, as one range', () => {
    // The old connector joined its two bounds with OR, which matches
    // everything on either side of them.
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe(`${ANY('x')} AND bibjson.year:[2024 TO 3000]`);
    expect(translate(query({ terms: ['x'], years: { to: 2021 } })))
      .toBe(`${ANY('x')} AND bibjson.year:[1500 TO 2021]`);
  });
});

describe('translate — DOI', () => {
  it('looks a DOI up by identifier', () => {
    expect(translate(query({ doi: '10.3390/v14092045' })))
      .toBe('bibjson.identifier.id:"10.3390\\/v14092045"');
  });

  it('escapes characters the query parser would read as operators', () => {
    expect(translate(query({ terms: ['a:b'] }))).toContain('a\\:b');
  });
});
