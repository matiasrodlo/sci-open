import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate', () => {
  it('makes the implicit AND explicit', () => {
    // `everything:` already requires every term — 5,940 hits whether the AND
    // is spelled or not — so this states what PLOS was already doing.
    expect(translate(query({ terms: ['crispr', 'gene'] })))
      .toBe('(everything:crispr AND everything:gene)');
  });

  it('quotes a phrase', () => {
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe('everything:crispr AND everything:"gene editing"');
  });

  it('keeps an OR join from swallowing the date clause', () => {
    expect(translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2022, to: 2023 } })))
      .toBe('(everything:a OR everything:b) AND publication_date:[2022-01-01T00:00:00Z TO 2023-12-31T23:59:59Z]');
  });

  it('looks a DOI up by id, because PLOS has no doi field', () => {
    // Measured: `doi:"10.1371/journal.pgen.1002441"` matches 64,432 documents
    // — PLOS accepts the unknown field and returns the corpus rather than
    // erroring — where `id:"..."` matches exactly one. A PLOS id is its DOI.
    expect(translate(query({ doi: '10.1371/journal.pone.0253351' })))
      .toBe('id:"10.1371/journal.pone.0253351"');
  });

  it('invents neither end of an open date range', () => {
    // The old connector defaulted a missing lower bound to the year 2000 and a
    // missing upper bound to the current year, silently excluding anything
    // outside two bounds nobody asked for.
    expect(translate(query({ terms: ['x'], years: { to: 2021 } })))
      .toBe('everything:x AND publication_date:[2000-01-01T00:00:00Z TO 2021-12-31T23:59:59Z]');
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('everything:x AND publication_date:[2024-01-01T00:00:00Z TO 9999-12-31T23:59:59Z]');
  });

  it('emits no date clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'] }))).toBe('everything:x');
  });
});
