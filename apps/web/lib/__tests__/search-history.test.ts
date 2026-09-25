// @vitest-environment jsdom
//
// `sessionStorage` is the subject here, not an incidental dependency — this
// module exists to decide what belongs in it and what happens when it refuses.
// The suite defaults to node; see `vitest.config.ts`.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandSets } from '@open-access-explorer/shared';
import {
  clearHistory, readHistory, record, rememberLabel, setTexts, takeLabel
} from '../search-history';

/**
 * The numbering, which is the part that would go wrong quietly.
 *
 * A set number is something a reader types into a later search, so it is a
 * name they rely on. Two behaviours protect that and neither is visible from
 * the outside until it fails: the same search does not mint a new number, and a
 * number is never handed to a second search.
 */

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('recording a search', () => {
  it('numbers from one', () => {
    expect(record({ label: 'crispr', expanded: 'crispr', total: 10 })).toEqual([
      expect.objectContaining({ number: 1, label: 'crispr', expanded: 'crispr', total: 10 })
    ]);
  });

  it('numbers each new search in turn', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    record({ label: 'AU=Doudna', expanded: 'AU=Doudna' });

    expect(readHistory().map(s => [s.number, s.label])).toEqual([[1, 'crispr'], [2, 'AU=Doudna']]);
  });

  /**
   * `/results` re-renders on every page of a result set, every sort change and
   * every facet tick. Numbering each of those would bury the history in
   * duplicates within one sitting of reading results.
   */
  it('does not mint a new number for a search already run', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 10 });
    record({ label: 'crispr', expanded: 'crispr', total: 10 });

    expect(readHistory()).toHaveLength(1);
  });

  it('refreshes the count on the set that is already there', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 10 });
    record({ label: 'crispr', expanded: 'crispr', total: 4212 });

    expect(readHistory()).toEqual([expect.objectContaining({ number: 1, total: 4212 })]);
  });

  it('keeps whether the count is a floor, and drops the mark when it no longer is', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 684999, atLeast: true });
    expect(readHistory()[0]).toMatchObject({ total: 684999, atLeast: true });

    record({ label: 'crispr', expanded: 'crispr', total: 53 });
    expect(readHistory()[0]!.total).toBe(53);
    expect(readHistory()[0]!.atLeast).toBeUndefined();
  });

  it('keeps the count and its mark when handed no count', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 684999, atLeast: true });
    record({ label: 'crispr', expanded: 'crispr' });

    expect(readHistory()[0]).toMatchObject({ total: 684999, atLeast: true });
  });

  it('keeps the query as it was typed, not as it was expanded', () => {
    record({ label: '#1 AND #2', expanded: '(crispr) AND (AU=Doudna)' });

    expect(readHistory()[0]!.label).toBe('#1 AND #2');
    expect(readHistory()[0]!.expanded).toBe('(crispr) AND (AU=Doudna)');
  });

  it('falls back to the query when there is no label', () => {
    expect(record({ label: '   ', expanded: 'crispr' })[0]!.label).toBe('crispr');
  });

  it('records nothing for an empty query', () => {
    expect(record({ label: '', expanded: '   ' })).toEqual([]);
  });
});

/**
 * The invariant a reader's typed `#1` depends on. If eviction renumbered, a
 * reference written a minute ago would start pointing at a different search —
 * silently, and with plausible results.
 */
describe('numbers are never reused', () => {
  const fill = (n: number) => {
    for (let i = 1; i <= n; i += 1) record({ label: `q${i}`, expanded: `q${i}` });
  };

  it('evicts the oldest past the cap', () => {
    fill(52);
    const sets = readHistory();

    expect(sets).toHaveLength(50);
    expect(sets[0]!.label).toBe('q3');
  });

  it('gives the next search a number above the highest ever issued', () => {
    fill(52);
    record({ label: 'later', expanded: 'later' });

    const sets = readHistory();
    expect(sets[sets.length - 1]!.number).toBe(53);
  });

  it('leaves a gap where an evicted set was, rather than shifting the rest', () => {
    fill(52);
    // #1 and #2 are gone; #3 is still #3 and nothing has moved under it.
    expect(readHistory().find(s => s.number === 3)?.label).toBe('q3');
    expect(readHistory().some(s => s.number === 1)).toBe(false);
  });
});

describe('setTexts', () => {
  it('indexes by number so position N-1 is set #N', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    record({ label: 'AU=Doudna', expanded: 'AU=Doudna' });

    expect(setTexts(readHistory())).toEqual(['crispr', 'AU=Doudna']);
  });

  /**
   * The two halves meeting: a reference to an evicted set has to land in a gap
   * and be refused, not resolve to whatever moved into that position.
   */
  it('leaves an evicted set as a gap the grammar refuses', () => {
    const sets = [
      { number: 2, label: 'b', expanded: 'b', at: '' },
      { number: 3, label: 'c', expanded: 'c', at: '' }
    ];

    expect(setTexts(sets)).toEqual(['', 'b', 'c']);
    expect(() => expandSets('#1', setTexts(sets))).toThrow(/no longer in the search history/);
    expect(expandSets('#3', setTexts(sets))).toBe('(c)');
  });
});

describe('the label carried across the navigation', () => {
  it('comes back for the search it belongs to', () => {
    rememberLabel('#1 AND #2', '(crispr) AND (AU=Doudna)');
    expect(takeLabel('(crispr) AND (AU=Doudna)')).toBe('#1 AND #2');
  });

  it('is read once', () => {
    rememberLabel('#1', '(crispr)');
    takeLabel('(crispr)');
    expect(takeLabel('(crispr)')).toBeUndefined();
  });

  /**
   * A label left behind by a navigation that never landed must not be attached
   * to whatever is rendered next — it would name the search wrongly in a list
   * the reader then types numbers out of.
   */
  it('is refused for a different search', () => {
    rememberLabel('#1 AND #2', '(crispr) AND (AU=Doudna)');
    expect(takeLabel('something else')).toBeUndefined();
  });

  it('is simply absent when nothing was typed', () => {
    expect(takeLabel('crispr')).toBeUndefined();
  });
});

describe('when storage will not cooperate', () => {
  it('reads as empty rather than throwing', () => {
    // A private window, or site data blocked. The search must still work.
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readHistory()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('survives a write it cannot make', () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => record({ label: 'crispr', expanded: 'crispr' })).not.toThrow();
    vi.restoreAllMocks();
  });

  it('ignores a stored value that is not a history', () => {
    window.sessionStorage.setItem('sci-open:search-history', '{"not":"an array"}');
    expect(readHistory()).toEqual([]);
  });

  it('drops a malformed entry rather than letting it become a set number', () => {
    window.sessionStorage.setItem(
      'sci-open:search-history',
      JSON.stringify([{ number: 1, label: 'ok', expanded: 'ok', at: '' }, { number: 'two' }])
    );

    expect(readHistory()).toHaveLength(1);
  });
});

describe('clearing', () => {
  it('empties the history', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    expect(clearHistory()).toEqual([]);
    expect(readHistory()).toEqual([]);
  });

  /**
   * Numbering restarts after a clear, which is the point of clearing — the
   * references the reader might still have in flight are cleared with it.
   */
  it('restarts the numbering', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    clearHistory();

    expect(record({ label: 'new', expanded: 'new' })[0]!.number).toBe(1);
  });
});
