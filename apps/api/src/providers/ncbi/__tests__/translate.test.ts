import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate', () => {
  it('joins terms explicitly, matching PubMed\'s own implicit AND', () => {
    expect(translate(query({ terms: ['crispr', 'gene', 'editing'] })))
      .toBe('((crispr[tiab] OR crispr[mh]) AND (gene[tiab] OR gene[mh]) AND (editing[tiab] OR editing[mh]))');
  });

  it('quotes a phrase so PubMed keeps the words adjacent', () => {
    // Measured: quoting narrows 25,236 hits to 20,462 on the same words.
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe('(crispr[tiab] OR crispr[mh]) AND ("gene editing"[tiab] OR "gene editing"[mh])');
  });

  it('keeps an OR join from swallowing the clauses beside it', () => {
    expect(translate(query({ terms: ['a', 'b'], join: 'OR' }), { openAccessOnly: true }))
      .toBe('((a[tiab] OR a[mh]) OR (b[tiab] OR b[mh])) AND pubmed pmc open access[filter]');
  });

  it('quotes a DOI, whose slashes PubMed would otherwise tokenise', () => {
    expect(translate(query({ doi: '10.1038/s41586-020-2008-3' })))
      .toBe('"10.1038/s41586-020-2008-3"[DOI]');
  });

  it('uses the open-access subset name PubMed actually has', () => {
    // There is no `"open access"[Filter]`; quoting a filter PubMed does not
    // know makes it a literal phrase that matches nothing, and the query
    // silently returns zero.
    expect(translate(query({ terms: ['x'] }), { openAccessOnly: true }))
      .toContain('pubmed pmc open access[filter]');
  });

  it('adds no access clause when it was not asked for', () => {
    expect(translate(query({ terms: ['x'] }))).toBe('(x[tiab] OR x[mh])');
  });
});

/**
 * Unscoped, PubMed searches every field it has. Measured on `ai` against the
 * PMC open-access subset: **287,637** matches unscoped, **60,399** in the
 * title or abstract. The 227,238 in between are author names — 16,910 papers
 * have an author surnamed Ai — affiliations and journal titles, and they were
 * being counted next to DOAJ's title/abstract/keywords figure as though the
 * two answered the same question.
 *
 * `[mh]` rides along because dropping the subject index would be a real loss
 * rather than a noise cut. On `crispr`, where the indexing is doing work:
 * 37,290 unscoped, 34,557 `[tiab]`, 34,719 with `[mh]` beside it.
 */
describe('translate — the scope of the search', () => {
  it('searches the title, the abstract and the MeSH headings', () => {
    expect(translate(query({ terms: ['ai'] }))).toBe('(ai[tiab] OR ai[mh])');
  });

  it('scopes a phrase the same way, quotes and all', () => {
    expect(translate(query({ phrases: ['gene editing'] })))
      .toBe('("gene editing"[tiab] OR "gene editing"[mh])');
  });

  it('leaves a DOI lookup unscoped, since a DOI is in neither field', () => {
    expect(translate(query({ doi: '10.1/x' }))).toBe('"10.1/x"[DOI]');
  });

  it('tolerates a word that is no MeSH heading', () => {
    // PubMed reports it in `phrasesnotfound` and matches nothing on that side
    // of the OR — verified live — which is right while `[tiab]` carries the
    // query. It is not an error and must not be avoided by pre-checking.
    expect(translate(query({ terms: ['zzqqxx'] }))).toBe('(zzqqxx[tiab] OR zzqqxx[mh])');
  });
});

describe('translate — year bounds', () => {
  it('expresses both bounds as one range', () => {
    expect(translate(query({ terms: ['x'], years: { from: 2022, to: 2023 } })))
      .toBe('(x[tiab] OR x[mh]) AND 2022:2023[PDAT]');
  });

  it('fills an open end with PubMed\'s conventional bound', () => {
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('(x[tiab] OR x[mh]) AND 2024:3000[PDAT]');
    expect(translate(query({ terms: ['x'], years: { to: 2021 } })))
      .toBe('(x[tiab] OR x[mh]) AND 1800:2021[PDAT]');
  });

  it('emits no date clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'], years: {} }))).toBe('(x[tiab] OR x[mh])');
  });
});
