import { describe, it, expect } from 'vitest';
import { QueryParseError, expandSets, formatExpression, parseExpression, referencesSets } from '../query-grammar';

/**
 * Combining numbered searches, the way Web of Science does: every search you run
 * gets a number, and the numbers are themselves searchable.
 *
 * It is a query algebra and not a set algebra — `#1 AND #2` is "the query that
 * was #1, and the query that was #2", not "the records each returned,
 * intersected". So the output is just a longer query, and nothing downstream of
 * the parser learns that sets exist.
 */

const SETS = ['crispr', 'AU=Doudna', 'cas9 OR "base editing"'];

describe('expanding a set reference', () => {
  it('substitutes the query the set ran', () => {
    expect(expandSets('#1', SETS)).toBe('(crispr)');
  });

  it('combines two sets', () => {
    expect(expandSets('#1 AND #2', SETS)).toBe('(crispr) AND (AU=Doudna)');
  });

  it('combines a set with fresh text', () => {
    expect(expandSets('#1 NOT PY=2024', SETS)).toBe('(crispr) NOT PY=2024');
  });

  it('handles a reference inside brackets', () => {
    expect(expandSets('(#1 OR #2) AND #3', SETS))
      .toBe('((crispr) OR (AU=Doudna)) AND (cas9 OR "base editing")');
  });

  /**
   * The brackets are not decoration. `#3` is `cas9 OR "base editing"`, and
   * pasted in bare, `#3 AND PY=2024` would bind the `AND` to the last
   * alternative alone — a different question, asked silently.
   */
  it('brackets a substitution so precedence cannot change the question', () => {
    const bare = parseExpression('cas9 OR "base editing" AND PY=2024');
    const combined = parseExpression(expandSets('#3 AND PY=2024', SETS));

    expect(formatExpression(bare)).toBe('TS=cas9 OR (TS="base editing" AND PY=2024-2024)');
    expect(formatExpression(combined)).toBe('(TS=cas9 OR TS="base editing") AND PY=2024-2024');
  });

  it('leaves text with no references untouched', () => {
    expect(expandSets('TS=crispr NOT AU=Doudna', SETS)).toBe('TS=crispr NOT AU=Doudna');
  });

  /**
   * `#1` inside quotes is the characters `#1`. Substituting there would turn a
   * search for a string into a search for whatever the reader happened to run
   * first, which is the quiet kind of wrong this whole area is arranged against.
   */
  it('does not substitute inside a quoted phrase', () => {
    expect(expandSets('TI="#1 ranked"', SETS)).toBe('TI="#1 ranked"');
  });

  it('leaves a bare hash alone', () => {
    expect(expandSets('C#', SETS)).toBe('C#');
    expect(expandSets('#abc', SETS)).toBe('#abc');
  });
});

describe('a reference that cannot be resolved', () => {
  it('refuses a set that has not been run', () => {
    expect(() => expandSets('#4', SETS)).toThrow(/#4 is not a search you have run/);
  });

  it('refuses #0, because sets are numbered from one', () => {
    expect(() => expandSets('#0', SETS)).toThrow(QueryParseError);
  });

  /**
   * An empty slot is a set the history has dropped. Numbers stay stable across
   * an eviction — renumbering would make an older `#1` point at a different
   * search — so the gap is what a reference to a dropped set lands in.
   */
  it('refuses a set the history has dropped', () => {
    expect(() => expandSets('#1', ['', 'crispr'])).toThrow(/#1 is no longer in the search history/);
  });

  it('says where the reference was', () => {
    try {
      expandSets('crispr AND #9', SETS);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as QueryParseError).position).toBe(11);
    }
  });

  it('refuses nothing when there is no history at all', () => {
    expect(() => expandSets('#1', [])).toThrow(QueryParseError);
    expect(expandSets('crispr', [])).toBe('crispr');
  });
});

describe('referencesSets', () => {
  it('spots a reference', () => {
    expect(referencesSets('#1 AND crispr')).toBe(true);
  });

  it('does not count one inside a phrase', () => {
    expect(referencesSets('TI="#1 ranked"')).toBe(false);
  });

  it('does not count a word that merely contains a hash', () => {
    expect(referencesSets('C# AND #abc')).toBe(false);
  });
});
