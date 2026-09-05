import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate — the defect this provider exists to fix', () => {
  // The old connector sent `all:crispr gene editing`, which arXiv reads as
  // `all:crispr OR all:gene OR all:editing`. Measured live: 23,510 hits topped
  // by "Primer on the Gene Ontology" and "Gene Ontology: Pitfalls, Biases,
  // Remedies". The AND form returns 16, all on the subject.
  it('requires every term rather than any of them', () => {
    const out = translate(query({ terms: ['crispr', 'gene', 'editing'] }));
    expect(out).toBe('((ti:crispr OR abs:crispr) AND (ti:gene OR abs:gene) AND (ti:editing OR abs:editing))');
  });

  it('prefixes every term, since a bare word after the first is not searched', () => {
    expect(translate(query({ terms: ['crispr', 'gene'] }))).toContain('(ti:gene OR abs:gene)');
  });

  it('keeps a phrase adjacent', () => {
    const out = translate(query({ terms: ['crispr'], phrases: ['gene editing'] }));
    expect(out).toBe('(ti:crispr OR abs:crispr) AND (ti:"gene editing" OR abs:"gene editing")');
  });

  it('requires a phrase even when the terms are joined with OR', () => {
    const out = translate(query({ terms: ['a', 'b'], phrases: ['gene editing'], join: 'OR' }));
    expect(out).toBe('((ti:a OR abs:a) OR (ti:b OR abs:b)) AND (ti:"gene editing" OR abs:"gene editing")');
  });

  it('keeps an OR join from swallowing the clauses beside it', () => {
    const out = translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2020 } }));
    expect(out).toBe('((ti:a OR abs:a) OR (ti:b OR abs:b)) AND submittedDate:[202001010000 TO 999912312359]');
  });

  it('drops a quote rather than sending an unbalanced one', () => {
    // arXiv documents no escape, and an unbalanced quote makes it reject the
    // whole query rather than the one clause.
    expect(translate(query({ phrases: ['a "quoted" run'] })))
      .toBe('(ti:"a quoted run" OR abs:"a quoted run")');
  });
});

describe('translate — year bounds', () => {
  // The wildcard form the old connector used made arXiv answer HTTP 500 with
  // an error document, and the connector's catch-all turned that into an empty
  // array — so arXiv silently left every year-filtered search. Both endpoints
  // are therefore concrete.
  it('never emits a wildcard endpoint', () => {
    const bounds = [{ from: 2022, to: 2023 }, { from: 2024 }, { to: 2021 }];
    for (const years of bounds) {
      expect(translate(query({ terms: ['x'], years }))).not.toContain('*');
    }
  });

  it('expresses both bounds as one range', () => {
    const out = translate(query({ terms: ['x'], years: { from: 2022, to: 2023 } }));
    expect(out).toBe('(ti:x OR abs:x) AND submittedDate:[202201010000 TO 202312312359]');
  });

  it('fills an open end with a real date', () => {
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('(ti:x OR abs:x) AND submittedDate:[202401010000 TO 999912312359]');
    // 1991 is arXiv's first year, so nothing is excluded by the lower bound.
    expect(translate(query({ terms: ['x'], years: { to: 2021 } })))
      .toBe('(ti:x OR abs:x) AND submittedDate:[199101010000 TO 202112312359]');
  });

  it('emits no date clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'], years: {} }))).toBe('(ti:x OR abs:x)');
  });
});

describe('translate — what arXiv cannot express', () => {
  it('emits no DOI clause, since arXiv has no DOI index', () => {
    // `capabilities.doiLookup` is false, so the orchestrator skips arXiv for a
    // DOI lookup and names the missing capability. Emitting a term here would
    // turn a skip into a search for the DOI as free text.
    expect(translate(query({ doi: '10.1234/abc' }))).toBe('');
  });

  it('adds no access clause, because every arXiv record is already open', () => {
    const out = translate(query({ terms: ['x'] }), { openAccessOnly: true });
    expect(out).toBe('(ti:x OR abs:x)');
  });
});

/**
 * `all:` is every metadata field arXiv holds — the authors, the submitter's
 * comments, the journal reference, the category names — so the count it
 * produced was answering a looser question than DOAJ's title/abstract/keywords
 * figure sitting next to it in the panel.
 *
 * The composite below is verified against the live API: `(ti:crispr OR
 * abs:crispr) AND (ti:"gene editing" OR abs:"gene editing")` returns 13
 * records, so the syntax parses and the AND across two scoped groups binds the
 * way it reads.
 *
 * On `crispr` alone the scoped and unscoped forms return **112 each** — this
 * one is a guard against a term that collides with an author's name or a
 * category label, not a measured narrowing. Saying so here because the number
 * is the obvious thing to look for and it is not there.
 */
describe('translate — the scope of the search', () => {
  it('searches the title and the abstract, and nothing else', () => {
    const out = translate(query({ terms: ['crispr'] }));
    expect(out).toBe('(ti:crispr OR abs:crispr)');
    expect(out).not.toContain('all:');
  });

  it('gives every term its own pair, because a prefix binds one token', () => {
    // One pair wrapping the whole query would scope the first word and leave
    // the rest loose — the same trap Europe PMC has, where
    // `TITLE_ABS:gene editing` matches 220,538 where the quoted phrase matches
    // 7,740.
    expect(translate(query({ terms: ['a', 'b'] })))
      .toBe('((ti:a OR abs:a) AND (ti:b OR abs:b))');
  });
});
