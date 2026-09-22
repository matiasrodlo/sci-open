import { describe, it, expect } from 'vitest';
import { QueryParseError, formatExpression } from '@open-access-explorer/shared';
import { parseQuery } from '../parse-query';

/**
 * Three of these changed meaning when the grammar arrived, and the changes are
 * the feature rather than fallout:
 *
 * - `AND`, `OR` and `NOT` are operators now. `"a" and "b"` used to yield a term
 *   `and` beside the two phrases, which was the flat parser having nowhere to
 *   put an operator, not a decision.
 * - An unclosed quote is an error. The flat parser left it alone, which is right
 *   for a bag of words and wrong once operators exist, because swallowing the
 *   rest of the line changes what they apply to.
 * - Every keyword query now carries an `expression`. The flat fields are still
 *   there and still mean what they meant; they are derived from the tree.
 */

/** The flat half of the result, which is what the old tests asserted on. */
const flat = ({ terms, phrases, join }: ReturnType<typeof parseQuery>) => ({ terms, phrases, join });

describe('parseQuery', () => {
  it('splits bare words into terms', () => {
    expect(flat(parseQuery('crispr gene editing'))).toEqual({
      terms: ['crispr', 'gene', 'editing'], phrases: [], join: 'AND'
    });
  });

  it('keeps a quoted run as one phrase', () => {
    expect(flat(parseQuery('"gene editing"'))).toEqual({
      terms: [], phrases: ['gene editing'], join: 'AND'
    });
  });

  it('does not also emit a phrase\'s words as terms', () => {
    expect(flat(parseQuery('crispr "gene editing"'))).toEqual({
      terms: ['crispr'], phrases: ['gene editing'], join: 'AND'
    });
  });

  it('reads a bare word as a Topic clause, as Web of Science does', () => {
    expect(formatExpression(parseQuery('crispr').expression!)).toBe('TS=crispr');
  });

  it('treats and/or/not between phrases as the operators they are', () => {
    // The old parser produced a term `and` here, having nowhere to put one.
    const q = parseQuery('"gene editing" and "base editing"');
    expect(q.phrases).toEqual(['gene editing', 'base editing']);
    expect(q.terms).toEqual([]);
    expect(formatExpression(q.expression!)).toBe('TS="gene editing" AND TS="base editing"');
  });

  it('refuses an unclosed quote rather than guessing where it ends', () => {
    expect(() => parseQuery('crispr "gene editing')).toThrow(QueryParseError);
  });

  it('recognises a bare DOI', () => {
    expect(parseQuery('10.1038/s41586-020-2649-2')).toEqual({
      terms: [], phrases: [], join: 'AND', doi: '10.1038/s41586-020-2649-2'
    });
  });

  it('recognises a doi.org URL', () => {
    expect(parseQuery('https://doi.org/10.1038/nature12373').doi).toBe('10.1038/nature12373');
  });

  it('does not mistake a sentence containing a DOI for a DOI lookup', () => {
    expect(parseQuery('see 10.1038/nature12373 for details').doi).toBeUndefined();
  });

  it('carries the requested join and year bounds', () => {
    const q = parseQuery('a b', { join: 'OR', years: { from: 2020, to: 2023 } });
    expect(q.join).toBe('OR');
    expect(q.years).toEqual({ from: 2020, to: 2023 });
    // The join reaches the grammar too: adjacency means what the caller said.
    expect(formatExpression(q.expression!)).toBe('TS=a OR TS=b');
  });

  it('returns an empty query for empty input', () => {
    expect(parseQuery('   ')).toEqual({ terms: [], phrases: [], join: 'AND' });
  });
});

describe('parseQuery: the Web of Science grammar', () => {
  const expression = (input: string) => formatExpression(parseQuery(input).expression!);

  it('scopes a tagged clause to its field', () => {
    expect(expression('AU=Doudna')).toBe('AU=Doudna');
    expect(expression('TI=crispr')).toBe('TI=crispr');
  });

  it('accepts a colon as well as an equals sign', () => {
    expect(expression('AU:Doudna')).toBe('AU=Doudna');
  });

  it('gives a tagged group its tag, so its members inherit it', () => {
    expect(expression('AU=(Doudna OR Charpentier)')).toBe('AU=Doudna OR AU=Charpentier');
  });

  it('keeps a tag written inside a group', () => {
    expect(expression('AU=(Doudna OR TI=crispr)')).toBe('AU=Doudna OR TI=crispr');
  });

  it('reads NOT as an exclusion from what precedes it', () => {
    expect(expression('TS=crispr NOT AU=Doudna')).toBe('TS=crispr AND NOT AU=Doudna');
  });

  it('binds AND tighter than OR', () => {
    expect(expression('a AND b OR c')).toBe('(TS=a AND TS=b) OR TS=c');
  });

  it('lets parentheses override that', () => {
    expect(expression('a AND (b OR c)')).toBe('TS=a AND (TS=b OR TS=c)');
  });

  it('reads a year and a year range', () => {
    expect(expression('PY=2020')).toBe('PY=2020-2020');
    expect(expression('PY=2020-2024')).toBe('PY=2020-2024');
    expect(expression('PY=2020-')).toBe('PY=2020-');
  });

  /**
   * An unknown tag is an ordinary word, which is what keeps a pasted URL or a
   * variant like `BRCA1:c.68` searchable rather than a syntax error.
   */
  it('leaves an unrecognised prefix as part of the term', () => {
    expect(expression('foo:bar')).toBe('TS=foo:bar');
  });

  it('refuses the proximity operators rather than searching for the word', () => {
    expect(() => parseQuery('gene NEAR/3 editing')).toThrow(/NEAR/);
    expect(() => parseQuery('gene SAME editing')).toThrow(/SAME/);
  });

  it('refuses an unbalanced parenthesis', () => {
    expect(() => parseQuery('TS=(crispr')).toThrow(QueryParseError);
    expect(() => parseQuery('crispr)')).toThrow(QueryParseError);
  });

  it('refuses an operator with nothing after it', () => {
    expect(() => parseQuery('crispr AND')).toThrow(QueryParseError);
  });

  it('refuses a tag with nothing after it', () => {
    expect(() => parseQuery('TS=')).toThrow(QueryParseError);
  });

  it('refuses a year that is not a year', () => {
    expect(() => parseQuery('PY=soon')).toThrow(QueryParseError);
    expect(() => parseQuery('PY=2024-2020')).toThrow(/backwards/);
  });

  it('says where the problem was', () => {
    try {
      parseQuery('crispr AND (gene');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(QueryParseError);
      expect((error as QueryParseError).position).toBe(11);
    }
  });
});

/**
 * The flat fields are a widening of the tree, never a narrowing — the
 * orchestrator can filter a record a provider returned and cannot recover one
 * it did not. See `flatten`.
 */
describe('parseQuery: what the providers are handed', () => {
  /**
   * The flat form has nowhere to put a field, so whoever reads it searches a
   * bare word the way they search any bare word — the title, the abstract and
   * whatever keywords they keep. Carrying an author or a venue there would make
   * the flattening *narrower* than the query, which is the one thing it may not
   * be: measured live, `SO=Nature AND TS=genome` reached OpenAlex as
   * `title_and_abstract.search:Nature genome`, requiring the journal's name in
   * the title of every result.
   */
  it('does not carry a field the flat form would search as body text', () => {
    expect(parseQuery('SO=Nature AND TS=genome').terms).toEqual(['genome']);
    expect(parseQuery('AU=Doudna AND TS=crispr').terms).toEqual(['crispr']);
    expect(parseQuery('PU=Elsevier AND TS=crispr').terms).toEqual(['crispr']);
  });

  it('leaves the flat form empty when every clause is field-scoped', () => {
    // A provider with no fielded search then contributes nothing to this
    // query, which is honest: it has no way to answer what was asked.
    expect(parseQuery('AU=Doudna').terms).toEqual([]);
    expect(parseQuery('AU=Doudna').phrases).toEqual([]);
  });

  it('drops a NOT from the flat form, which widens it', () => {
    const q = parseQuery('TS=crispr NOT AU=Doudna');
    expect(q.terms).toEqual(['crispr']);
    expect(q.join).toBe('AND');
  });

  it('joins alternatives with OR rather than requiring both', () => {
    const q = parseQuery('TS=cas9 OR TS=crispr');
    expect(q.terms).toEqual(['cas9', 'crispr']);
    expect(q.join).toBe('OR');
  });

  it('keeps only what every branch of an OR requires', () => {
    // `a` is required either way; `b` and `c` are alternatives.
    const q = parseQuery('(a AND b) OR (a AND c)');
    expect(q.terms).toEqual(['a']);
    expect(q.join).toBe('AND');
  });

  it('lifts a year clause onto the bound the providers already express', () => {
    expect(parseQuery('TS=crispr AND PY=2020-2024').years).toEqual({ from: 2020, to: 2024 });
  });

  it('intersects a PY clause with the year facet, because both narrow', () => {
    const q = parseQuery('PY=2015-2024', { years: { from: 2020, to: 2030 } });
    expect(q.years).toEqual({ from: 2020, to: 2024 });
  });

  it('routes a sole DO= clause to the DOI lookup', () => {
    const q = parseQuery('DO=10.1038/nature12373');
    expect(q.doi).toBe('10.1038/nature12373');
    expect(q.expression).toBeUndefined();
  });

  /**
   * A DOI inside a larger query is one condition among several. Routing it to
   * the DOI-lookup path would discard the rest of the query silently.
   */
  it('does not route a DO= clause that is part of a bigger query', () => {
    const q = parseQuery('DO=10.1038/nature12373 OR TS=crispr');
    expect(q.doi).toBeUndefined();
    expect(q.expression).toBeDefined();
  });
});
