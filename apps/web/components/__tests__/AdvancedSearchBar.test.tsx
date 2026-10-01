// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AdvancedSearchBar } from '../AdvancedSearchBar';
import { record } from '@/lib/search-history';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push })
}));

/**
 * The box every search goes through, and until now the only part of the search
 * path with no test at all.
 *
 * Two things happen here that happen nowhere else: a `#N` is resolved against a
 * history the service cannot see, and the resolved query — not the typed one —
 * is what reaches the URL. Both are easy to break without any other test
 * noticing, because every other test starts from a query that has already been
 * through this.
 */

beforeEach(() => {
  push.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

const box = () => screen.getByRole('searchbox', { name: 'Search open-access papers' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

/**
 * The `q` the last navigation carried, decoded.
 *
 * Read back through `URLSearchParams` rather than compared as a string: it
 * writes a space as `+` and leaves brackets alone, and pinning one particular
 * spelling of a correct URL would fail the day any of that changed.
 */
const searchedFor = (): string | null => {
  const url = push.mock.calls.at(-1)?.[0] as string | undefined;
  return url ? new URLSearchParams(url.split('?')[1]).get('q') : null;
};

describe('running a search', () => {
  it('searches on Enter', () => {
    render(<AdvancedSearchBar />);
    type('crispr');
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(searchedFor()).toBe('crispr');
  });

  it('searches on the button', () => {
    render(<AdvancedSearchBar />);
    type('crispr');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(searchedFor()).toBe('crispr');
  });

  it('does not search on Shift+Enter', () => {
    render(<AdvancedSearchBar />);
    type('crispr');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });

    expect(push).not.toHaveBeenCalled();
  });

  it('does nothing with an empty box', () => {
    render(<AdvancedSearchBar />);
    type('   ');
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(push).not.toHaveBeenCalled();
  });

  it('reports every keystroke to a parent that asked', () => {
    // `SearchWithHistory` appends `#2` to what is in the box, so it has to know.
    const onQueryChange = vi.fn();
    render(<AdvancedSearchBar onQueryChange={onQueryChange} />);
    type('cris');

    expect(onQueryChange).toHaveBeenCalledWith('cris');
  });
});

describe('a query that names a set', () => {
  it('sends the expansion, not the reference', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    record({ label: 'AU=Doudna', expanded: 'AU=Doudna' });

    render(<AdvancedSearchBar />);
    type('#1 AND #2');
    fireEvent.keyDown(box(), { key: 'Enter' });

    // The URL says what was asked, so the link still means it tomorrow.
    expect(searchedFor()).toBe('(crispr) AND (AU=Doudna)');
  });

  it('keeps the typed form for the history to show', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    render(<AdvancedSearchBar />);
    type('#1 NOT PY=2024');
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(window.sessionStorage.getItem('sci-open:pending-label'))
      .toContain('#1 NOT PY=2024');
  });

  it('refuses a set that was never run, without navigating', () => {
    render(<AdvancedSearchBar />);
    type('#9');
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('#9 is not a search you have run');
  });

  /**
   * The error is about text the reader can see and is about to change. Leaving
   * it up while they fix it says the new query is broken too, before anything
   * has looked at it.
   */
  it('takes the complaint back once the query is edited', () => {
    render(<AdvancedSearchBar />);
    type('#9');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.queryByRole('alert')).not.toBeNull();

    type('#9 crispr');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The box shows the search the page is showing.
 *
 * `initialQuery` is the query in the URL, and it changes without anything being
 * typed — the back button, a shared link opened in place, a result page
 * restored from history. A box that kept the last thing typed would then
 * describe a different search from the one listed underneath it.
 */
describe('following the URL', () => {
  it('updates when the query behind it changes', () => {
    const { rerender } = render(<AdvancedSearchBar initialQuery="crispr" />);
    expect((box() as HTMLInputElement).value).toBe('crispr');

    rerender(<AdvancedSearchBar initialQuery="AU=Doudna" />);
    expect((box() as HTMLInputElement).value).toBe('AU=Doudna');
  });
});
