import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate, toParams } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('toParams — the year filter the old path could not express', () => {
  it('uses a range, not comparison operators', () => {
    // `publication_year:>=2022,publication_year:<=2024` is rejected outright:
    // HTTP 400, "Value for param publication_year must be a number." So every
    // year-bounded search lost OpenAlex — invisibly, because
    // `validateStatus: status < 500` resolved the 400 as a success.
    const params = toParams(query({ terms: ['crispr'], years: { from: 2022, to: 2024 } }));
    expect(params.filter).toBe('publication_year:2022-2024,title_and_abstract.search:crispr');
    expect(params.filter).not.toContain('>=');
  });

  it('fills an open end with a concrete bound', () => {
    // Verified equal to the `>` and `<` forms: 78,150 either way for 2024
    // onward, 61,925 either way for 2021 and earlier.
    expect(toParams(query({ terms: ['x'], years: { from: 2024 } })).filter)
      .toBe('publication_year:2024-9999,title_and_abstract.search:x');
    expect(toParams(query({ terms: ['x'], years: { to: 2021 } })).filter)
      .toBe('publication_year:1000-2021,title_and_abstract.search:x');
  });

  it('emits nothing but the search when no bound was asked for', () => {
    expect(toParams(query({ terms: ['x'] })).filter).toBe('title_and_abstract.search:x');
  });
});

describe('toParams — search and filters', () => {
  it('quotes a phrase and leaves bare terms alone', () => {
    expect(toParams(query({ terms: ['crispr'], phrases: ['gene editing'] })).filter)
      .toBe('title_and_abstract.search:crispr "gene editing"');
  });

  it('asks for open access as a filter OpenAlex applies upstream', () => {
    expect(toParams(query({ terms: ['x'] }), { openAccessOnly: true }).filter)
      .toBe('is_oa:true,title_and_abstract.search:x');
  });

  it('combines the access and year filters', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2022, to: 2024 } }), { openAccessOnly: true });
    expect(params.filter).toBe('is_oa:true,publication_year:2022-2024,title_and_abstract.search:x');
  });

  it('looks a DOI up as a filter, not as free text', () => {
    // Sent as a search term the old path found 267 loosely-matching records
    // instead of the one paper.
    const params = toParams(query({ doi: '10.1038/S41586-020-2008-3' }));
    expect(params.filter).toBe('doi:10.1038/s41586-020-2008-3');
    expect(params.filter).not.toContain('title_and_abstract');
  });
});

/**
 * The `search` parameter searches the full text as well. Measured on `ai` with
 * `is_oa:true`: **4,636,103** matches for `search=ai`, **940,199** for
 * `title_and_abstract.search:ai`.
 *
 * The difference is why the header's "+ matching" floor was being set by
 * whichever provider asked the vaguest question — and it is a precision
 * change too, since a paper that mentions the words somewhere in its body was
 * competing for the 600 records the fan-out reads.
 */
describe('toParams — the scope of the search', () => {
  it('searches the title and abstract, not the full text', () => {
    expect(toParams(query({ terms: ['ai'] })).filter).toBe('title_and_abstract.search:ai');
  });

  it('asks for nothing at all when there is nothing to search for', () => {
    // `is_oa:true` standing alone is a valid filter — for the whole
    // open-access corpus. The caller reads this emptiness to decide whether to
    // make the request, so an empty query has to come back genuinely empty.
    expect(toParams(query({ terms: [], phrases: [] }), { openAccessOnly: true })).toEqual({});
    expect(toParams(query({ terms: ['  '], phrases: ['""'] }), { openAccessOnly: true })).toEqual({});
  });

  it('still asks for a DOI with no words to go with it', () => {
    // A DOI lookup is not an empty query, and returns before the search clause.
    expect(toParams(query({ doi: '10.1/x' }), { openAccessOnly: true }).filter)
      .toBe('is_oa:true,doi:10.1/x');
  });

  it('keeps a comma out of the value, which would read as a second filter', () => {
    // `,` separates filters and `|` is OR within one. There is no documented
    // escape, so the words either side are kept and the punctuation is not.
    expect(toParams(query({ terms: ['crispr,cas9'] })).filter)
      .toBe('title_and_abstract.search:crispr cas9');
    expect(toParams(query({ phrases: ['a|b'] })).filter)
      .toBe('title_and_abstract.search:"a b"');
  });
});

describe('translate — the cache key', () => {
  it('carries the year bounds, so a bounded search is not served from an unbounded one', () => {
    const unbounded = translate(query({ terms: ['crispr'] }));
    const bounded = translate(query({ terms: ['crispr'], years: { from: 2022, to: 2024 } }));
    expect(bounded).not.toBe(unbounded);
  });

  it('serialises the same search identically every time', () => {
    const q = query({ terms: ['crispr'], years: { from: 2022 } });
    expect(translate(q, { openAccessOnly: true }))
      .toBe('filter=is_oa:true,publication_year:2022-9999,title_and_abstract.search:crispr');
  });
});
