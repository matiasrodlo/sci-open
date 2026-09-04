import { describe, it, expect } from 'vitest';
import {
  toList, toSingle, withFilter, toPage, toYear, toSort, MAX_PAGE, MIN_YEAR, MAX_YEAR
} from '../search-params';

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

describe('toPage', () => {
  // An out-of-range page used to be passed straight to the API, where the
  // schema requires `1 <= page <= 1000` and answers 400 — which reached the
  // reader as "There was an error performing your search", blaming the service
  // for a URL that asked for a page which cannot exist.
  it('clamps a negative page to the first one', () => {
    // `parseInt('-5') || 1` is -5, because -5 is truthy. That was the bug.
    expect(toPage('-5')).toBe(1);
    expect(toPage('0')).toBe(1);
  });

  it('clamps past the end to the last page the API will serve', () => {
    expect(toPage('99999')).toBe(MAX_PAGE);
  });

  it.each([undefined, '', 'abc', 'NaN'])('falls back to page 1 for %s', value => {
    expect(toPage(value as any)).toBe(1);
  });

  it('keeps a page in range', () => {
    expect(toPage('7')).toBe(7);
    expect(toPage(String(MAX_PAGE))).toBe(MAX_PAGE);
  });

  it('reads the first value when the parameter is repeated', () => {
    expect(toPage(['3', '9'])).toBe(3);
  });

  it('takes the integer part of a decimal rather than rejecting it', () => {
    expect(toPage('2.9')).toBe(2);
  });
});

/**
 * `toYear` and `toSort` exist for the reason `toPage` does: every one of these
 * parameters is constrained by the API's schema, and any value outside it
 * answers 400, which this page renders as "There was an error performing your
 * search" — the service reported broken for a URL that merely asked for
 * something that cannot exist.
 */
describe('toYear', () => {
  it('passes a year in range through', () => {
    expect(toYear('2019')).toBe(2019);
  });

  it.each([undefined, '', 'abc', 'NaN'])('is undefined — no bound at all — for %s', value => {
    // Unparseable means there is no year to filter on, so the honest answer is
    // the unfiltered set. `yearFrom ? parseInt(yearFrom) : undefined` produced
    // NaN here, which JSON.stringify writes as null, which the schema rejects.
    expect(toYear(value as any)).toBeUndefined();
  });

  it('clamps out of range rather than dropping the bound', () => {
    // Clamping matters most in the upper direction: dropping `yearTo=99999`
    // would silently widen the search to everything, where clamping keeps what
    // the reader plainly meant.
    expect(toYear('999')).toBe(MIN_YEAR);
    expect(toYear('99999')).toBe(MAX_YEAR);
    expect(toYear('-5')).toBe(MIN_YEAR);
  });

  it('reads the first value when the parameter is repeated', () => {
    expect(toYear(['2019', '2020'])).toBe(2019);
  });
});

describe('toSort', () => {
  it('passes every sort the API accepts through unchanged', () => {
    for (const sort of ['relevance', 'date', 'date_asc', 'citations', 'citations_asc',
                        'author', 'author_desc', 'venue', 'venue_desc', 'title', 'title_desc']) {
      expect(toSort(sort)).toBe(sort);
    }
  });

  it.each(['year', 'newest', 'date_desc', 'DATE', '', undefined])(
    'falls back to relevance for %s',
    value => {
      // `?sort=year` from a stale bookmark or an older build of this page used
      // to reach the API as `(sort as any)` and answer 400. Relevance is the
      // fallback because it is already what a *missing* sort means, so an
      // unreadable one lands where an absent one would.
      expect(toSort(value as any)).toBe('relevance');
    }
  );

  it('does not accept an inherited property as a sort', () => {
    // The lookup is an own-property check: `'toString' in SORTS` is true.
    expect(toSort('toString')).toBe('relevance');
    expect(toSort('constructor')).toBe('relevance');
  });
});
