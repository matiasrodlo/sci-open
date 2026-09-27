import { describe, it, expect } from 'vitest';
import type { SearchResponse } from '@open-access-explorer/shared';
import { searchKey, worthCaching } from '../search-key';

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  hits: [], facets: {}, page: 1, pageSize: 20, total: 0, ...over
});

describe('searchKey', () => {
  // The key used to be built from a `query` argument passed in beside the
  // params, and the route passed `params.q || ''`. `params.doi` never reached
  // it, so every DOI lookup with no `q` shared one key — and the single-flight
  // guard coalesced concurrent ones onto a single fan-out, answering both with
  // one of the two works.
  it('separates two different DOI lookups', () => {
    expect(searchKey({ doi: '10.1234/aaa' })).not.toBe(searchKey({ doi: '10.5678/bbb' }));
  });

  it('keys a DOI lookup on the DOI, not on the absent query', () => {
    // `runOrchestrator` builds its Query from `params.doi ?? params.q`, so the
    // key has to name the DOI whether or not `q` is also set.
    expect(searchKey({ doi: '10.1234/aaa', q: 'crispr' })).toBe(searchKey({ doi: '10.1234/aaa' }));
    expect(searchKey({ doi: '10.1234/aaa' })).not.toBe(searchKey({ q: 'crispr' }));
  });

  it('separates queries that differ only in punctuation', () => {
    // `\w` is ASCII-only in JavaScript, so stripping everything outside
    // `[\w\s]` folded these pairs together.
    expect(searchKey({ q: 'TNF-\u03b1' })).not.toBe(searchKey({ q: 'TNF' }));
    expect(searchKey({ q: 'alpha/beta' })).not.toBe(searchKey({ q: 'alphabeta' }));
  });

  it('still folds case and runs of whitespace', () => {
    expect(searchKey({ q: '  Machine   Learning ' })).toBe(searchKey({ q: 'machine learning' }));
  });

  it('separates pages and sorts of the same search', () => {
    expect(searchKey({ q: 'crispr', page: 2 })).not.toBe(searchKey({ q: 'crispr' }));
    expect(searchKey({ q: 'crispr', sort: 'date' })).not.toBe(searchKey({ q: 'crispr' }));
    expect(searchKey({ q: 'crispr', page: 1, pageSize: 20, sort: 'relevance' })).toBe(searchKey({ q: 'crispr' }));
  });

  it('is the same for the same filters in any order', () => {
    expect(searchKey({ q: 'crispr', filters: { year: ['2024', '2023'], venue: ['Nature'] } }))
      .toBe(searchKey({ q: 'crispr', filters: { venue: ['Nature'], year: ['2023', '2024'] } }));
  });
});

describe('worthCaching', () => {
  it('is false only for an answer that reported itself incomplete', () => {
    expect(worthCaching(response({ complete: false }))).toBe(false);
    expect(worthCaching(response({ complete: true }))).toBe(true);
  });

  it('treats an absent `complete` as cacheable', () => {
    // Only an explicit false is evidence of a degraded read.
    expect(worthCaching(response())).toBe(true);
  });
});
