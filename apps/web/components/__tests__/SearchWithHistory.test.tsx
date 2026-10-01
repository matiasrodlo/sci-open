// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SearchWithHistory } from '../SearchWithHistory';
import { record } from '@/lib/search-history';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}));

/**
 * The wiring between the box and the numbered sets: clicking `#2` has to type
 * into the box, and the box has to keep describing the search on screen.
 */

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

const box = () => screen.getByRole('searchbox') as HTMLInputElement;
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: /Search history/ }));

describe('inserting a set', () => {
  it('puts the reference in an empty box', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    render(<SearchWithHistory initialQuery="" />);
    openHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Add #1 to the search box' }));

    expect(box().value).toBe('#1');
  });

  it('joins it to what is already there', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    render(<SearchWithHistory initialQuery="AU=Doudna" />);
    openHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Add #1 to the search box' }));

    expect(box().value).toBe('AU=Doudna AND #1');
  });

  it('does not add a second operator after one already written', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    render(<SearchWithHistory initialQuery="AU=Doudna NOT" />);
    openHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Add #1 to the search box' }));

    expect(box().value).toBe('AU=Doudna NOT #1');
  });

  /**
   * The reason the box reports every keystroke upward. Appending to the last
   * value this component handed down would discard whatever was typed after it.
   */
  it('appends to what was typed, not to what was last handed down', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    render(<SearchWithHistory initialQuery="" />);
    fireEvent.change(box(), { target: { value: 'AU=Doudna' } });

    openHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Add #1 to the search box' }));

    expect(box().value).toBe('AU=Doudna AND #1');
  });
});

/**
 * `initialQuery` is the query in the URL, and it changes without anything being
 * typed: the back button, a shared link opened in place, a restored history
 * entry. `AdvancedSearchBar` follows it, but it only ever sees what this
 * component passes down — so if the draft here ignores the URL, the box
 * describes one search while the results underneath describe another.
 */
describe('following the URL', () => {
  it('updates the box when the query behind it changes', () => {
    const { rerender } = render(<SearchWithHistory initialQuery="crispr" />);
    expect(box().value).toBe('crispr');

    rerender(<SearchWithHistory initialQuery="AU=Doudna" />);
    expect(box().value).toBe('AU=Doudna');
  });

  it('does not undo typing while the URL stays put', () => {
    const { rerender } = render(<SearchWithHistory initialQuery="crispr" />);
    fireEvent.change(box(), { target: { value: 'cas9' } });

    // A re-render for any other reason must not drag the box back.
    rerender(<SearchWithHistory initialQuery="crispr" />);
    expect(box().value).toBe('cas9');
  });
});
