// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { FacetPanel } from '../FacetPanel';

const { push, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams()
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams
}));

/**
 * The panel's job is that a bucket's count states how far ticking it narrows
 * the result set. Its one piece of real arithmetic is the publication-type
 * roll-up, and that arithmetic has been wrong before in a way no type could
 * catch: it counted `facets.source` against a hardcoded three-provider map,
 * so on a measured search it showed "Peer Reviewed 1,100" where the stages said
 * 1,769 — plos, doaj and openaire are peer-reviewed journal sources and were
 * all dropped — and "Pre-print 0" against an actual 5.
 *
 * A zero beside a box that returns five results is the worse half of that, and
 * it is what these pin.
 */

const facets = (over: Record<string, unknown> = {}) => ({
  stage: [
    { value: 'published', count: 1500 },
    { value: 'accepted', count: 269 },
    { value: 'preprint', count: 5 },
    { value: 'unknown', count: 40 }
  ],
  year: [
    { value: 2024, count: 10 },
    { value: 2022, count: 30 },
    { value: 2023, count: 20 }
  ],
  venue: [{ value: 'Bioinformatics (Oxford, England)', count: 12 }],
  publisher: [{ value: 'Nature Publishing Group', count: 7 }],
  topics: [{ value: 'crispr', count: 9 }],
  ...over
});

/**
 * The rendered label/count pairs of one facet group, in order.
 *
 * `closest('div')` is the row that holds one checkbox, its label and its count.
 * Going one further up reaches the list that holds every row, which returns the
 * whole group's text for each entry and makes any ordering assertion pass on
 * the first value it finds.
 */
const group = (heading: RegExp) => {
  const region = screen.getByRole('group', { name: heading });
  return within(region)
    .getAllByRole('checkbox')
    .map(box => box.closest('div')?.textContent ?? '');
};

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe('publication type, rolled up from stage', () => {
  it('counts peer-reviewed as accepted plus published, which is what the filter runs on', () => {
    // The API maps `publicationType` to stages — peer-reviewed to `accepted`
    // and `published` — so counting anything else makes the number beside a box
    // disagree with what ticking it returns.
    render(<FacetPanel facets={facets()} />);

    expect(group(/Publication Type/)[0]).toContain('1,769');
  });

  it('counts pre-print from the preprint stage', () => {
    render(<FacetPanel facets={facets()} />);

    expect(group(/Publication Type/)[1]).toContain('5');
  });

  it('leaves an unknown stage in neither bucket rather than inventing one', () => {
    // They need not add up to the total, and a paper whose stage is unknown
    // cannot be filtered to either.
    render(<FacetPanel facets={facets()} />);

    const rows = group(/Publication Type/);
    expect(rows.join(' ')).not.toContain('40');
  });

  it('shows zero rather than crashing when the stage facet is missing', () => {
    render(<FacetPanel facets={facets({ stage: undefined })} />);

    const rows = group(/Publication Type/);
    expect(rows[0]).toContain('0');
    expect(rows[1]).toContain('0');
  });
});

describe('how buckets are ordered and shown', () => {
  it('orders years by year, not by count', () => {
    render(<FacetPanel facets={facets()} />);

    const years = group(/Year/).map(t => t.match(/\d{4}/)?.[0]);
    expect(years).toEqual(['2024', '2023', '2022']);
  });

  it('keeps a venue containing a comma whole', () => {
    // The value travels as a repeated query parameter precisely so this
    // survives; comma-joining it is what made such filters un-clickable.
    render(<FacetPanel facets={facets()} />);

    expect(screen.getByText('Bioinformatics (Oxford, England)')).toBeTruthy();
  });

  it('shortens a publisher name it has a label for', () => {
    render(<FacetPanel facets={facets()} />);

    expect(screen.getByText('Nature')).toBeTruthy();
  });

  it('hides a group with no buckets rather than showing an empty heading', () => {
    render(<FacetPanel facets={facets({ topics: [] })} />);

    expect(screen.queryByRole('group', { name: /Topics/ })).toBeNull();
  });

  it('survives a facet that is not an array', () => {
    // `facets` is `Record<string, any>` on the wire, so this is reachable
    // from a response rather than only from a mistake here.
    expect(() => render(<FacetPanel facets={facets({ venue: 'nonsense' })} />)).not.toThrow();
  });
});

describe('ticking a box', () => {
  it('writes the value as a repeated parameter and drops the page', () => {
    render(<FacetPanel facets={facets()} />);

    const box = within(screen.getByRole('group', { name: /Year/ })).getAllByRole('checkbox')[0]!;
    box.click();

    expect(push).toHaveBeenCalledOnce();
    const url = new URLSearchParams(push.mock.calls[0]![0].split('?')[1]);
    expect(url.getAll('year')).toEqual(['2024']);
    expect(url.has('page')).toBe(false);
  });
});
