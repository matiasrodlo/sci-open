import { describe, it, expect } from 'vitest';
import { toList, toSingle, withFilter } from '../search-params';

/**
 * Facet values contain commas constantly — measured, 25 values in a single
 * result set, including ordinary journal names. Comma-joining them into one
 * parameter and splitting on the way back is what made them un-clickable.
 */
const COMMA_VALUE = 'Bioinformatics (Oxford, England)';

describe('toList', () => {
  it('wraps a single value', () => {
    expect(toList('crispr')).toEqual(['crispr']);
  });

  it('passes a repeated parameter through as the list it is', () => {
    expect(toList(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps a value containing commas whole', () => {
    expect(toList(COMMA_VALUE)).toEqual([COMMA_VALUE]);
  });

  it('is undefined when the parameter is absent or empty', () => {
    expect(toList(undefined)).toBeUndefined();
    expect(toList('')).toBeUndefined();
    expect(toList([])).toBeUndefined();
    expect(toList(['', ''])).toBeUndefined();
  });
});

describe('toSingle', () => {
  it('takes the first value when a parameter is repeated', () => {
    expect(toSingle(['2020', '2021'])).toBe('2020');
  });

  it('is undefined for an absent parameter', () => {
    expect(toSingle(undefined)).toBeUndefined();
  });
});

describe('withFilter', () => {
  const base = () => new URLSearchParams('q=crispr&page=4');

  it('writes each value as its own parameter', () => {
    const params = withFilter(base(), 'venue', ['A', 'B']);
    expect(params.getAll('venue')).toEqual(['A', 'B']);
  });

  it('round-trips a value containing commas', () => {
    const params = withFilter(base(), 'venue', [COMMA_VALUE]);
    // Encoded in the string, and one value again on the way out.
    expect(params.toString()).toContain('venue=Bioinformatics+%28Oxford%2C+England%29');
    expect(new URLSearchParams(params.toString()).getAll('venue')).toEqual([COMMA_VALUE]);
  });

  it('resets the page, because a narrowed set may not have the one you are on', () => {
    expect(withFilter(base(), 'venue', ['A']).has('page')).toBe(false);
  });

  it('replaces the previous values rather than appending to them', () => {
    const first = withFilter(base(), 'venue', ['A', 'B']);
    expect(withFilter(first, 'venue', ['C']).getAll('venue')).toEqual(['C']);
  });

  it('removes the parameter entirely when nothing is selected', () => {
    const first = withFilter(base(), 'venue', ['A']);
    expect(withFilter(first, 'venue', []).has('venue')).toBe(false);
  });

  it('leaves other parameters alone', () => {
    const params = withFilter(base(), 'venue', ['A']);
    expect(params.get('q')).toBe('crispr');
  });
});
