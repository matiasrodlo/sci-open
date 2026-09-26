// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { OARecord } from '@open-access-explorer/shared';
import PaperPage from '../[id]/page';

const { record } = vi.hoisted(() => ({ record: { current: null as unknown } }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'plos%3A10.1371%2Fjournal.pone.0000001' })
}));

vi.mock('@/lib/fetcher', () => ({
  getPaper: vi.fn(async () => record.current)
}));

const paper = (over: Partial<OARecord> = {}): OARecord => ({
  id: 'plos:10.1371/journal.pone.0000001',
  title: 'A paper nobody has cited yet',
  authors: ['A. Author'],
  source: 'plos',
  sourceId: '10.1371/journal.pone.0000001',
  createdAt: '2026-01-01T00:00:00Z',
  ...over
});

/** Every text node on the page, trimmed — where a stray `0` would sit. */
const textNodes = (root: Node): string[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) found.push(text);
  }
  return found;
};

afterEach(cleanup);

describe('PaperPage', () => {
  it('renders nothing for a citation count of zero', async () => {
    // `citationCount && …` evaluates to 0, and React prints a 0.
    record.current = paper({ citationCount: 0 });
    const { container } = render(<PaperPage />);
    await screen.findByRole('heading', { name: /nobody has cited/ });

    expect(textNodes(container)).not.toContain('0');
    expect(screen.queryByText(/citations?$/)).toBeNull();
  });

  it('shows a citation count above zero', async () => {
    record.current = paper({ citationCount: 3 });
    render(<PaperPage />);
    await screen.findByRole('heading', { name: /nobody has cited/ });

    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });
});
