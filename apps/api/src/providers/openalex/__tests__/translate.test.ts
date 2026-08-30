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
    expect(params.filter).toBe('publication_year:2022-2024');
    expect(params.filter).not.toContain('>=');
  });

  it('fills an open end with a concrete bound', () => {
    // Verified equal to the `>` and `<` forms: 78,150 either way for 2024
    // onward, 61,925 either way for 2021 and earlier.
    expect(toParams(query({ terms: ['x'], years: { from: 2024 } })).filter)
      .toBe('publication_year:2024-9999');
    expect(toParams(query({ terms: ['x'], years: { to: 2021 } })).filter)
      .toBe('publication_year:1000-2021');
  });

  it('emits no filter when nothing was asked for', () => {
    expect(toParams(query({ terms: ['x'] })).filter).toBeUndefined();
  });
});

describe('toParams — search and filters', () => {
  it('quotes a phrase and leaves bare terms alone', () => {
    expect(toParams(query({ terms: ['crispr'], phrases: ['gene editing'] })).search)
      .toBe('crispr "gene editing"');
  });

  it('asks for open access as a filter OpenAlex applies upstream', () => {
    expect(toParams(query({ terms: ['x'] }), { openAccessOnly: true }).filter).toBe('is_oa:true');
  });

  it('combines the access and year filters', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2022, to: 2024 } }), { openAccessOnly: true });
    expect(params.filter).toBe('is_oa:true,publication_year:2022-2024');
  });

  it('looks a DOI up as a filter, not as free text', () => {
    // Sent as a search term the old path found 267 loosely-matching records
    // instead of the one paper.
    const params = toParams(query({ doi: '10.1038/S41586-020-2008-3' }));
    expect(params.filter).toBe('doi:10.1038/s41586-020-2008-3');
    expect(params.search).toBeUndefined();
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
      .toBe('filter=is_oa:true,publication_year:2022-9999&search=crispr');
  });
});
