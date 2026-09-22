import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';
import { parseQuery } from '../../../orchestrator/parse-query';

const query = (over: Partial<Query> = {}): Query => ({
  terms: [], phrases: [], join: 'AND', ...over
});

describe('translate', () => {
  it('joins bare terms with AND by default', () => {
    expect(translate(query({ terms: ['crispr', 'editing'] })))
      .toBe('((TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) AND (TITLE_ABS:editing OR MESH:editing OR KW:editing))');
  });

  it('honours an OR join', () => {
    expect(translate(query({ terms: ['crispr', 'talen'], join: 'OR' })))
      .toBe('((TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) OR (TITLE_ABS:talen OR MESH:talen OR KW:talen))');
  });

  it('does not parenthesise a single term', () => {
    expect(translate(query({ terms: ['crispr'] }))).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr)');
  });

  it('quotes phrases so the words must stay adjacent', () => {
    // The whole reason Query carries structure: a raw string cannot say this,
    // which is why arXiv turns "crispr gene editing" into an OR of three words.
    expect(translate(query({ phrases: ['gene editing'] })))
      .toBe('(TITLE_ABS:"gene editing" OR MESH:"gene editing" OR KW:"gene editing")');
  });

  it('combines terms and phrases', () => {
    const out = translate(query({ terms: ['crispr'], phrases: ['gene editing'] }));
    expect(out).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) AND (TITLE_ABS:"gene editing" OR MESH:"gene editing" OR KW:"gene editing")');
  });

  it('keeps an OR join from swallowing the clauses beside it', () => {
    // `a OR b AND PUB_YEAR:[2020 TO *]` does not mean what it looks like.
    const out = translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2020 } }));
    expect(out).toBe('((TITLE_ABS:a OR MESH:a OR KW:a) OR (TITLE_ABS:b OR MESH:b OR KW:b)) AND PUB_YEAR:[2020 TO *]');
  });

  it('escapes a quote inside a phrase', () => {
    expect(translate(query({ phrases: ['the "hard" problem'] })))
      .toBe('(TITLE_ABS:"the \\"hard\\" problem" OR MESH:"the \\"hard\\" problem" OR KW:"the \\"hard\\" problem")');
  });

  it('builds a DOI lookup and ignores keywords', () => {
    const out = translate(query({ doi: '10.1234/abc', terms: ['ignored'] }));
    expect(out).toBe('DOI:"10.1234/abc"');
  });

  // Range syntax, not comparison operators. Europe PMC accepts `PUB_YEAR:>=n`
  // and silently ignores it, returning the unbounded corpus with an unchanged
  // hit count — after which the orchestrator's own year filter discarded the
  // whole page and a year-bounded search returned nothing.
  it('expresses both year bounds as a range', () => {
    const out = translate(query({ terms: ['x'], years: { from: 2019, to: 2023 } }));
    expect(out).toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[2019 TO 2023]');
  });

  it('leaves the open end of a one-sided bound as a wildcard', () => {
    expect(translate(query({ terms: ['x'], years: { to: 2023 } })))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[* TO 2023]');
    expect(translate(query({ terms: ['x'], years: { from: 2019 } })))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND PUB_YEAR:[2019 TO *]');
  });

  it('emits no year clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'], years: {} }))).toBe('(TITLE_ABS:x OR MESH:x OR KW:x)');
  });

  it('adds the open-access term only when asked', () => {
    // Policy, not a provider constant: the old connector always appended it.
    expect(translate(query({ terms: ['x' ] }))).not.toContain('OPEN_ACCESS');
    expect(translate(query({ terms: ['x'] }), { openAccessOnly: true }))
      .toBe('(TITLE_ABS:x OR MESH:x OR KW:x) AND OPEN_ACCESS:y');
  });

  it('drops blank terms and phrases rather than emitting empty clauses', () => {
    expect(translate(query({ terms: ['crispr', '  '], phrases: [''] }))).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr)');
  });

  it('returns an empty string for an empty query', () => {
    expect(translate(query())).toBe('');
  });
});

/**
 * Unscoped, Europe PMC searches everything it indexes, and that number sat in
 * the panel beside DOAJ's title/abstract/keywords figure as though the two
 * asked the same question. Measured with `OPEN_ACCESS:y`: `ai` matches
 * **521,177** unscoped and **54,005** in `TITLE_ABS`.
 *
 * `MESH` and `KW` are in the scope because here they are not a rounding error:
 * `crispr` matches 31,567 in `TITLE_ABS` alone and **34,916** with the two
 * beside it.
 */
describe('translate — the scope of the search', () => {
  it('searches the title, abstract, MeSH headings and keywords', () => {
    expect(translate(query({ terms: ['ai'] })))
      .toBe('(TITLE_ABS:ai OR MESH:ai OR KW:ai)');
  });

  it('gives every term its own prefix, because a prefix binds one token', () => {
    // `TITLE_ABS:gene editing` scopes `gene` and leaves `editing` loose across
    // the whole index: 220,538 matches where the quoted phrase has 7,740.
    const out = translate(query({ terms: ['gene', 'editing'] }));
    expect(out).toBe(
      '((TITLE_ABS:gene OR MESH:gene OR KW:gene) AND (TITLE_ABS:editing OR MESH:editing OR KW:editing))'
    );
  });

  it('leaves a DOI lookup unscoped, since a DOI is in none of the four', () => {
    expect(translate(query({ doi: '10.1/x' }))).toBe('DOI:"10.1/x"');
  });
});

/**
 * The Web of Science grammar reaching Europe PMC's own syntax.
 *
 * Europe PMC is the richest dialect here — it has an index for every concept
 * the grammar names except `publisher` — so it is where a fielded query should
 * arrive almost intact, and where a regression would mean the fan-out is
 * spending its depth budget on records the query already excluded.
 */
describe('translate: the fielded grammar', () => {
  const q = (input: string) => translate(parseQuery(input));

  it('sends an author clause to AUTH rather than to the title', () => {
    // The flat path scoped every bare word to TITLE_ABS/MESH/KW, so `AU=` used
    // to reach Europe PMC as a search for the name in the title.
    expect(q('AU=Doudna')).toBe('AUTH:Doudna');
  });

  it('maps each tag to its own index', () => {
    expect(q('TI=crispr')).toBe('TITLE:crispr');
    expect(q('AB=crispr')).toBe('ABSTRACT:crispr');
    expect(q('SO=Nature')).toBe('JOURNAL:Nature');
  });

  it('keeps the measured three-field spread for a topic word', () => {
    expect(q('crispr')).toBe('(TITLE_ABS:crispr OR MESH:crispr OR KW:crispr)');
  });

  it('carries AND, OR and NOT into the native query', () => {
    expect(q('TI=crispr NOT AU=Doudna')).toBe('(TITLE:crispr AND NOT (AUTH:Doudna))');
    expect(q('AU=(Doudna OR Charpentier)')).toBe('(AUTH:Doudna OR AUTH:Charpentier)');
  });

  it('writes a PY clause as the range syntax, not as a comparison', () => {
    // `PUB_YEAR:>=2022` is accepted and then ignored — see the note in
    // `translate`. Both the clause and the year bound use the range form.
    //
    // The bound appears twice on purpose rather than by accident: `parseQuery`
    // lifts a required `PY` onto `query.years` so every provider can express
    // it, and the clause also renders where it sits in the tree. AND-ing two
    // bounds is their intersection, and these two are the same bound, so the
    // repetition costs query length and nothing else.
    expect(q('TI=crispr AND PY=2020-2024'))
      .toBe('(TITLE:crispr AND PUB_YEAR:[2020 TO 2024]) AND PUB_YEAR:[2020 TO 2024]');
  });

  it('widens a concept Europe PMC has no index for', () => {
    // No publisher index here, so the term goes to the whole index and
    // `matchesQuery` holds the record to the publisher field afterwards.
    expect(q('PU=Elsevier')).toBe('Elsevier');
  });

  it('still answers a plain query the way it always did', () => {
    expect(q('crispr "gene editing"')).toBe(
      '((TITLE_ABS:crispr OR MESH:crispr OR KW:crispr) AND (TITLE_ABS:"gene editing" OR MESH:"gene editing" OR KW:"gene editing"))'
    );
  });
});
