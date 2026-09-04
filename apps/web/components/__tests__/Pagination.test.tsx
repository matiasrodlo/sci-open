// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Pagination } from '../Pagination';

const { push, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams('q=crispr&venue=Nature')
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams
}));

/**
 * The page window is arithmetic with three branches and a pair of ellipses, and
 * it is the sort of thing that is written once and never looked at again — so
 * what is pinned here is that it always offers a way to the first and last
 * page, never repeats a number, and never offers one that does not exist.
 */

const paginate = (currentPage: number, totalPages: number) =>
  render(
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      totalResults={totalPages * 20}
      pageSize={20}
    />
  );

/** The page numbers offered, in order, ellipses dropped. */
const pages = () =>
  screen
    .getAllByRole('button')
    .map(b => b.textContent?.trim() ?? '')
    .filter(t => /^\d+$/.test(t))
    .map(Number);

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe('the page window', () => {
  it('lists every page when they fit', () => {
    paginate(1, 5);

    expect(pages()).toEqual([1, 2, 3, 4, 5]);
  });

  it('always offers the first and last page, however deep the reader is', () => {
    for (const current of [1, 4, 5, 20, 96, 100]) {
      paginate(current, 100);
      const offered = pages();
      expect(offered[0], `page ${current}`).toBe(1);
      expect(offered[offered.length - 1], `page ${current}`).toBe(100);
      cleanup();
    }
  });

  it('never offers a page that does not exist', () => {
    for (const current of [1, 3, 50, 100]) {
      paginate(current, 100);
      for (const page of pages()) {
        expect(page, `page ${current}`).toBeGreaterThanOrEqual(1);
        expect(page, `page ${current}`).toBeLessThanOrEqual(100);
      }
      cleanup();
    }
  });

  it('never repeats a page number', () => {
    // The three branches overlap at their boundaries, which is where a
    // duplicate would appear — and a duplicate key is a React warning nobody
    // reads plus two buttons that look identical.
    for (const current of [1, 4, 5, 6, 95, 96, 97, 100]) {
      paginate(current, 100);
      const offered = pages();
      expect(new Set(offered).size, `page ${current}`).toBe(offered.length);
      cleanup();
    }
  });

  it('keeps the current page inside the window', () => {
    for (const current of [1, 4, 5, 50, 96, 100]) {
      paginate(current, 100);
      expect(pages(), `page ${current}`).toContain(current);
      cleanup();
    }
  });

  it('renders nothing when there is only one page', () => {
    const { container } = paginate(1, 1);

    expect(container.firstChild).toBeNull();
  });
});

describe('moving between pages', () => {
  it('keeps the other filters when it changes page', () => {
    // The page is one parameter among several; losing the venue on a page
    // click would silently widen the search.
    paginate(1, 10);

    screen.getByText('3').click();

    const url = new URLSearchParams(push.mock.calls[0]![0].split('?')[1]);
    expect(url.get('page')).toBe('3');
    expect(url.get('q')).toBe('crispr');
    expect(url.get('venue')).toBe('Nature');
  });

  it('drops the page parameter entirely for page one', () => {
    // `?page=1` and no page at all are the same request, and the shorter URL
    // is the one worth putting in someone's history.
    paginate(3, 10);

    screen.getByText('1').click();

    const url = new URLSearchParams(push.mock.calls[0]![0].split('?')[1]);
    expect(url.has('page')).toBe(false);
    expect(url.get('q')).toBe('crispr');
  });

  it('disables the way back from the first page and on from the last', () => {
    paginate(1, 10);
    const [first, previous] = screen.getAllByRole('button');
    expect(first!.hasAttribute('disabled')).toBe(true);
    expect(previous!.hasAttribute('disabled')).toBe(true);

    cleanup();

    paginate(10, 10);
    const buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]!.hasAttribute('disabled')).toBe(true);
  });
});

describe('the results counter', () => {
  it('counts from one, not from zero', () => {
    paginate(1, 10);

    expect(screen.getByText(/Showing 1 to 20 of 200 results/)).toBeTruthy();
  });

  it('does not claim more results than there are on the last page', () => {
    render(
      <Pagination currentPage={3} totalPages={3} totalResults={45} pageSize={20} />
    );

    expect(screen.getByText(/Showing 41 to 45 of 45 results/)).toBeTruthy();
  });
});
