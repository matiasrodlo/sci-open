// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Paper } from '@open-access-explorer/shared';
import PaperPage from '../[id]/page';

const { record } = vi.hoisted(() => ({ record: { current: null as unknown } }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'plos%3A10.1371%2Fjournal.pone.0000001' })
}));

vi.mock('@/lib/fetcher', () => ({
  getPaper: vi.fn(async () => record.current)
}));

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'plos:10.1371/journal.pone.0000001',
  title: 'A paper nobody has cited yet',
  authors: ['A. Author'],
  topics: [],
  oaStatus: 'unknown',
  stage: 'unknown',
  sources: [{ provider: 'plos', nativeId: '10.1371/journal.pone.0000001', rank: 0, retrievedAt: '2026-01-01T00:00:00Z' }],
  fieldSources: {},
  retrievedAt: '2026-01-01T00:00:00Z',
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

  it('offers a copy that is a web page as full text to read, not as a PDF to download', async () => {
    // Offered as "Download PDF", it went through the PDF route, was refused
    // as HTML, and fell back to opening the page anyway.
    record.current = paper({ fullText: { url: 'https://core.ac.uk/reader/1', kind: 'html', verified: false } });
    render(<PaperPage />);
    await screen.findByRole('heading', { name: /nobody has cited/ });

    expect(screen.getByRole('button', { name: /Read Full Text/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull();
  });

  it('offers a PDF for download, and says whether it was checked', async () => {
    record.current = paper({ fullText: { url: 'https://example.org/a.pdf', kind: 'pdf', verified: true } });
    render(<PaperPage />);
    await screen.findByRole('heading', { name: /nobody has cited/ });

    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeTruthy();
    expect(screen.getByText(/^PDF, checked/)).toBeTruthy();
  });

  it('says which version this is under that name, and how it is open under its own', async () => {
    // The old "Access Status" row printed `published`: the version, wearing
    // the route's name.
    record.current = paper({ stage: 'preprint', oaStatus: 'green' });
    render(<PaperPage />);
    await screen.findByRole('heading', { name: /nobody has cited/ });

    expect(screen.getByText('Version').nextSibling?.textContent).toBe('Preprint');
    expect(screen.getByText('Open Access').nextSibling?.textContent).toBe('Green OA');
    expect(screen.queryByText('Access Status')).toBeNull();
  });
});
