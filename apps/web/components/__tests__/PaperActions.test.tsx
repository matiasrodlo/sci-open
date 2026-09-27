// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Paper } from '@open-access-explorer/shared';
import { PaperActions } from '../paper/PaperActions';

/**
 * The download, when the proxy cannot fetch the file.
 *
 * The fallback used to open the publisher's copy with `window.open` once the
 * proxy had answered, seconds after the click — late enough for a pop-up
 * blocker to refuse it, and with `noopener` the page could not tell that it
 * had. A link the reader clicks cannot be refused that way.
 */

const COPY = 'https://publisher.example.org/paper.pdf';

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'europepmc:1',
  title: 'A study of things',
  authors: ['Lovelace, Ada'],
  topics: [],
  oaStatus: 'gold',
  stage: 'published',
  fullText: { url: COPY, kind: 'pdf', verified: false },
  sources: [{ provider: 'europepmc', nativeId: '1', rank: 0, retrievedAt: '2026-01-01T00:00:00.000Z' }],
  fieldSources: {},
  retrievedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PaperActions — a download the proxy could not make', () => {
  it('offers the publisher’s copy as a link, and opens nothing itself', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Upstream returned 403 for the PDF', requestId: 'r' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    )));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<PaperActions paper={paper()} />);
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));

    const link = await screen.findByRole('link', { name: /publisher’s copy/ });
    expect(link.getAttribute('href')).toBe(COPY);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/Upstream returned 403 for the PDF/)).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it('offers no link for a copy whose address is not one to hand on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<PaperActions paper={paper({ fullText: { url: 'javascript:alert(1)//x.pdf', kind: 'pdf', verified: false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));

    expect(await screen.findByText(/status 502/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /publisher’s copy/ })).toBeNull();
  });
});
