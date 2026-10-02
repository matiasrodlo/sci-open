import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { parseExpression } from '@open-access-explorer/shared';
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

  it('asks for a phrase as one more alternative when the terms are joined with OR', () => {
    // It was required whatever the join, so `a OR b OR "gene editing"` was
    // asked as `(a OR b) AND "gene editing"`. See `joinFlat`.
    const out = translate(query({ terms: ['a', 'b'], phrases: ['gene editing'], join: 'OR' }));
    expect(out).toBe(`(${ANY('a')} OR ${ANY('b')} OR ${ANY('"gene editing"')})`);
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

/**
 * Measured with `bibjson.title:` on 2026-09-30: escaped, a wildcard is literal
 * text — `generat\*` found 1 against 51,814 for `generation` — and unescaped,
 * DOAJ refuses every one with HTTP 400. There is no form of one it answers.
 */
describe('translate — wildcards', () => {
  const anyField = (v: string) => `(bibjson.title:${v} OR bibjson.abstract:${v} OR bibjson.keywords:${v})`;

  it('asks nothing of a flat query carrying a wildcard, rather than searching for it as text', () => {
    for (const term of ['generat*', 'gen?me', '*generation']) {
      expect(translate(query({ terms: ['crispr', term] }))).toBe('');
    }
  });

  it('leaves out a title wildcard, which the evaluator applies, and asks nothing for a topic one', () => {
    // A title clause `matchesQuery` can check on the records that come back;
    // a topic clause it never convicts on, so leaving one out widens for good.
    expect(translate(query({ expression: parseExpression('TS=crispr AND TI=gen*') }))).toBe(anyField('crispr'));
    expect(translate(query({ expression: parseExpression('TS=crispr AND TS=gen*') }))).toBe('');
  });


  it('asks nothing when the wildcard is an alternative, or all there was', () => {
    expect(translate(query({ terms: ['crispr', 'gen*'], join: 'OR' }))).toBe('');
    expect(translate(query({ terms: ['gen*'], years: { from: 2020 } }))).toBe('');
  });
});

/**
 * DOAJ keeps an author's name word by word, and a quoted name matched only the
 * records that wrote it that way round — none, for the phrase a Web of Science
 * author search carries.
 */
describe('translate: an author phrase', () => {
  const q = (input: string) => translate(query({ expression: parseExpression(input) }));

  it('asks for the words of the name beside the phrase', () => {
    // Measured: 0 for the phrase, 59 for the words.
    expect(q('AU="Doudna, Jennifer"'))
      .toBe('(bibjson.author.name:"Doudna, Jennifer" OR (bibjson.author.name:Doudna AND bibjson.author.name:Jennifer))');
  });

  it('leaves a name already written as its words as it was', () => {
    expect(q('AU=Jennifer AND AU=Doudna')).toBe('(bibjson.author.name:Jennifer AND bibjson.author.name:Doudna)');
  });
});
