// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SearchHistory } from '../SearchHistory';
import { RecordSearch } from '../RecordSearch';
import { record } from '@/lib/search-history';

/**
 * The panel, and the thing it has to get right: the number on a row is what a
 * reader types into the next search, so the row has to name the set it claims
 * to name.
 */

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

const open = () => fireEvent.click(screen.getByRole('button', { name: /Search history/ }));

describe('SearchHistory', () => {
  it('renders nothing until something has been searched', () => {
    const { container } = render(<SearchHistory onInsert={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists what the session has run, with counts', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 4212 });
    record({ label: 'AU=Doudna', expanded: 'AU=Doudna', total: 194 });

    render(<SearchHistory onInsert={() => {}} />);
    open();

    expect(screen.getByText('crispr')).toBeTruthy();
    expect(screen.getByText('4,212')).toBeTruthy();
    expect(screen.getByText('194')).toBeTruthy();
  });

  it('shows the query as it was typed, not as it was expanded', () => {
    record({ label: '#1 AND #2', expanded: '(crispr) AND (AU=Doudna)' });

    render(<SearchHistory onInsert={() => {}} />);
    open();

    // Scoped to the list: the panel's own help line uses `#1 AND #2` as its
    // worked example, so an unscoped query matches the instructions as well.
    const list = within(screen.getByRole('list'));
    expect(list.getByText('#1 AND #2')).toBeTruthy();
    expect(list.queryByText('(crispr) AND (AU=Doudna)')).toBeNull();
  });

  it('hands the set number up when its button is clicked', () => {
    record({ label: 'crispr', expanded: 'crispr' });
    record({ label: 'AU=Doudna', expanded: 'AU=Doudna' });

    const onInsert = vi.fn();
    render(<SearchHistory onInsert={onInsert} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Add #2 to the search box' }));
    expect(onInsert).toHaveBeenCalledWith('#2');
  });

  it('says a set has no count yet rather than showing zero', () => {
    // Zero results and "not counted yet" are different facts, and one of them
    // would send a reader off to rewrite a query that worked.
    record({ label: 'crispr', expanded: 'crispr' });

    render(<SearchHistory onInsert={() => {}} />);
    open();

    const list = within(screen.getByRole('list'));
    expect(list.getByText('—')).toBeTruthy();
    expect(list.queryByText('0')).toBeNull();
  });

  it('empties on clear', () => {
    record({ label: 'crispr', expanded: 'crispr' });

    const { container } = render(<SearchHistory onInsert={() => {}} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(container.innerHTML).toBe('');
  });
});

/**
 * The two halves sit in different Suspense boundaries — the box renders at once
 * and the count only exists when the search returns — so a write by one has to
 * reach the other. If it does not, the history is a render behind for the whole
 * session and the newest set, the one most likely to be combined, is the one
 * missing.
 */
describe('a search recorded from the results boundary', () => {
  it('appears in a panel that was already on screen', () => {
    record({ label: 'crispr', expanded: 'crispr', total: 10 });

    render(
      <>
        <SearchHistory onInsert={() => {}} />
        <RecordSearch query="AU=Doudna" total={194} />
      </>
    );
    open();

    const list = within(screen.getByRole('list'));
    expect(list.getByText('AU=Doudna')).toBeTruthy();
    expect(list.getByText('194')).toBeTruthy();
  });

  it('does not record an empty query', () => {
    const { container } = render(
      <>
        <SearchHistory onInsert={() => {}} />
        <RecordSearch query="   " total={0} />
      </>
    );

    expect(container.innerHTML).toBe('');
  });
});
