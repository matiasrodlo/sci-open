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

  it('asks for alternatives as alternatives, not for their overlap', () => {
    // A space is AND to OpenAlex, so `cancer OR zebrafish` used to read the
    // 4,548 works with both instead of the 2,835,247 with either.
    expect(toParams(query({ terms: ['cancer', 'zebrafish'], join: 'OR' })).filter)
      .toBe('title_and_abstract.search:cancer OR zebrafish');
    expect(toParams(query({ terms: ['zebrafish'], phrases: ['gene editing'], join: 'OR' })).filter)
      .toBe('title_and_abstract.search:zebrafish OR "gene editing"');
  });

  it('keeps OR beside the filters it is combined with', () => {
    expect(toParams(query({ terms: ['cancer', 'zebrafish'], join: 'OR', years: { from: 2020 } }), { openAccessOnly: true }).filter)
      .toBe('is_oa:true,publication_year:2020-9999,title_and_abstract.search:cancer OR zebrafish');
  });

  it('writes no OR for a single alternative', () => {
    expect(toParams(query({ terms: ['cancer'], join: 'OR' })).filter).toBe('title_and_abstract.search:cancer');
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

/**
 * The stemmed `title_and_abstract.search` answers any wildcard with HTTP 400,
 * so every wildcard search used to lose OpenAlex. The exact field takes them,
 * under rules measured against the live API on 2026-09-29.
 */
describe('toParams — wildcards', () => {
  it('sends a wildcard to the exact field, beside the stemmed search', () => {
    expect(toParams(query({ terms: ['crispr', 'gen*'] })).filter)
      .toBe('title_and_abstract.search:crispr,title_and_abstract.search.exact:gen*');
    expect(toParams(query({ terms: ['gen*', 'g?ne'] })).filter)
      .toBe('title_and_abstract.search.exact:gen* g?ne');
  });

  it('sends every wildcard OpenAlex answers', () => {
    for (const term of ['gen*', 'gene*ing', 'abc*def*', 'g?ne', 'ge?e', 'x_y*']) {
      expect(toParams(query({ terms: [term] })).filter).toBe(`title_and_abstract.search.exact:${term}`);
    }
  });

  it('asks nothing when a wildcard is one OpenAlex refuses', () => {
    // Left out, it would widen the search for good if it was a topic term —
    // `matchesQuery` never convicts on one — and the flat form cannot say.
    for (const term of ['*ing', '?ene', 'ge*', 'gen?m*', 'ge?e*', 'covid-19*', 'c++*']) {
      expect(toParams(query({ terms: ['crispr', term] }))).toEqual({});
    }
  });

  it('asks nothing when a wildcard is one of several alternatives', () => {
    // Refused, it would be left out — the other side alone. Runnable, it goes
    // to a second filter, and filters are ANDed — the overlap. Both narrow.
    expect(toParams(query({ terms: ['crispr', '*ing'], join: 'OR' }))).toEqual({});
    expect(toParams(query({ terms: ['crispr', 'gen*'], join: 'OR' }))).toEqual({});
  });

  it('asks nothing when a refused wildcard was all there was', () => {
    expect(toParams(query({ terms: ['*ing'] }), { openAccessOnly: true })).toEqual({});
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

describe('toParams — the publication type', () => {
  it('asks for the types `normalize` calls a preprint', () => {
    expect(toParams(query({ terms: ['x'], stages: ['preprint'] })).filter)
      .toBe('type:preprint,title_and_abstract.search:x');
  });

  it('asks for every type `normalize` calls published', () => {
    // Read from `STAGES`, so a type added there is asked for here without a
    // second list to keep in step.
    expect(toParams(query({ terms: ['x'], stages: ['published', 'accepted'] })).filter)
      .toBe('type:article|book|book-chapter|dissertation|report,title_and_abstract.search:x');
  });

  it('writes a set including unknown as the types to leave out', () => {
    // Unknown is every type `STAGES` does not name, which cannot be listed.
    expect(toParams(query({ terms: ['x'], stages: ['preprint', 'unknown'] })).filter)
      .toBe('type:!article,type:!book,type:!book-chapter,type:!dissertation,type:!report,title_and_abstract.search:x');
  });

  it('asks nothing when no type carries the stages asked for', () => {
    expect(toParams(query({ terms: ['x'], stages: ['accepted'] }))).toEqual({});
  });

  it('leaves a DOI lookup unnarrowed', () => {
    expect(toParams(query({ doi: '10.1/x', stages: ['preprint'] })).filter).not.toContain('type:');
  });
});
