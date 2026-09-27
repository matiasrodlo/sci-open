// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Paper, SourceRef } from '@open-access-explorer/shared';
import { ResultCard } from '../ResultCard';

/**
 * What a card says beyond version 1's one-source record: how the paper is
 * open, which version it is, every source that returned it, and what its copy
 * is — none of which that shape could carry.
 */

const ref = (provider: SourceRef['provider']): SourceRef =>
  ({ provider, nativeId: '1', rank: 0, retrievedAt: '2026-01-01T00:00:00.000Z' });

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'europepmc:1',
  title: 'A study of things',
  authors: ['Lovelace, Ada'],
  topics: [],
  oaStatus: 'unknown',
  stage: 'published',
  sources: [ref('europepmc')],
  fieldSources: {},
  retrievedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

afterEach(cleanup);

describe('ResultCard', () => {
  it('names every source that returned the paper', () => {
    render(<ResultCard record={paper({ sources: [ref('europepmc'), ref('ncbi'), ref('openalex')] })} />);
    expect(screen.getByText('Found in Europe PMC, PubMed, OpenAlex')).toBeTruthy();
  });

  it('counts the sources past the first three rather than listing them', () => {
    render(<ResultCard record={paper({ sources: [ref('europepmc'), ref('ncbi'), ref('openalex'), ref('doaj'), ref('core')] })} />);
    const line = screen.getByText(/^Found in/);
    expect(line.textContent).toBe('Found in Europe PMC, PubMed, OpenAlex +2');
    expect(line.getAttribute('title')).toBe('Europe PMC, PubMed, OpenAlex, DOAJ, CORE');
  });

  it('says how the paper is open, and says nothing when that is not known', () => {
    render(<ResultCard record={paper({ oaStatus: 'gold' })} />);
    expect(screen.getByText('Gold OA').getAttribute('title')).toMatch(/open-access journal/);
    cleanup();

    render(<ResultCard record={paper({ oaStatus: 'unknown' })} />);
    expect(screen.queryByText(/ OA$/)).toBeNull();
  });

  it('marks a preprint, and leaves the version of record unmarked', () => {
    render(<ResultCard record={paper({ stage: 'preprint' })} />);
    expect(screen.getByText('Preprint')).toBeTruthy();
    cleanup();

    render(<ResultCard record={paper({ stage: 'published' })} />);
    expect(screen.queryByText(/Published version/)).toBeNull();
  });

  it('calls a copy that is a web page full text, and a PDF a PDF', () => {
    render(<ResultCard record={paper({ fullText: { url: 'https://core.ac.uk/reader/1', kind: 'html', verified: false } })} />);
    expect(screen.getByRole('button', { name: /full text of A study of things/ }).textContent).toBe('Full text');
    cleanup();

    render(<ResultCard record={paper({ fullText: { url: 'https://example.org/a.pdf', kind: 'pdf', verified: false } })} />);
    const button = screen.getByRole('button', { name: /PDF of A study of things/ });
    expect(button.textContent).toBe('PDF');
    expect(button.getAttribute('title')).toMatch(/not checked$/);
  });

  it('offers no copy it does not have', () => {
    render(<ResultCard record={paper({ fullText: undefined })} />);
    expect(screen.queryByRole('button', { name: /PDF of|full text of/ })).toBeNull();
  });
});
