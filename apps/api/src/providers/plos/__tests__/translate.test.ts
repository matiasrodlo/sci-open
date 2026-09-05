import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate', () => {
  it('makes the implicit AND explicit', () => {
    // `everything:` required every term whether the AND was spelled or not —
    // 5,940 hits either way — but only because `everything` is Solr's default
    // field here, so the words after the first landed in it regardless. Scoped,
    // the AND is doing real work.
    expect(translate(query({ terms: ['crispr', 'gene'] })))
      .toBe('((title:crispr OR abstract:crispr OR subject:crispr) AND (title:gene OR abstract:gene OR subject:gene))');
  });

  it('quotes a phrase', () => {
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe('(title:crispr OR abstract:crispr OR subject:crispr) AND (title:"gene editing" OR abstract:"gene editing" OR subject:"gene editing")');
  });

  it('keeps an OR join from swallowing the date clause', () => {
    expect(translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2022, to: 2023 } })))
      .toBe('((title:a OR abstract:a OR subject:a) OR (title:b OR abstract:b OR subject:b)) AND publication_date:[2022-01-01T00:00:00Z TO 2023-12-31T23:59:59Z]');
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
      .toBe('(title:x OR abstract:x OR subject:x) AND publication_date:[2000-01-01T00:00:00Z TO 2021-12-31T23:59:59Z]');
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('(title:x OR abstract:x OR subject:x) AND publication_date:[2024-01-01T00:00:00Z TO 9999-12-31T23:59:59Z]');
  });

  it('emits no date clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'] }))).toBe('(title:x OR abstract:x OR subject:x)');
  });
});

/**
 * PLOS publishes its own full text and indexes it, so `everything:` was
 * reading it — the same thing the OpenAlex `search` parameter does, and the
 * reason both moved. Measured on `crispr gene editing` against the
 * research-article filter: **5,563** through `everything`, **359** in the
 * title or abstract, **361** with `subject` beside them.
 */
describe('translate — the scope of the search', () => {
  it('searches the title, abstract and subject, not the full text', () => {
    const out = translate(query({ terms: ['crispr'] }));
    expect(out).toBe('(title:crispr OR abstract:crispr OR subject:crispr)');
    expect(out).not.toContain('everything');
  });

  it('gives every term its own prefix, because a Solr prefix binds one token', () => {
    // `title:gene editing` matches 7,301 — `gene` scoped, `editing` loose in
    // the default field — where `title:"gene editing"` matches 44. One prefix
    // wrapping the query would scope its first word and nothing else.
    expect(translate(query({ terms: ['gene', 'editing'] }))).toBe(
      '((title:gene OR abstract:gene OR subject:gene) AND ' +
        '(title:editing OR abstract:editing OR subject:editing))'
    );
  });

  it('leaves a DOI lookup on the id field, which is where a PLOS DOI lives', () => {
    expect(translate(query({ doi: '10.1371/journal.pone.0253351' })))
      .toBe('id:"10.1371/journal.pone.0253351"');
  });
});
