// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ProviderTotal } from '@open-access-explorer/shared';
import { ProviderCoverage } from '../ProviderCoverage';

/**
 * The three outcomes this panel keeps apart are the whole reason
 * `ProviderReport` exists, and telling them apart is entirely string work on
 * the `error` field — `skipped:` prefixed or not — which is exactly the kind of
 * distinction that collapses under a later edit.
 *
 * A provider that was *skipped* declined to guess: it has no keyword index, and
 * the backend says so rather than sending a query it knows will be answered
 * badly. A provider that *failed* was asked and did not answer, and only that
 * makes the total a lower bound. Reporting a skip as a failure is the bug
 * phase 08 fixed in the comparison sweep, and it would be the same bug here.
 */

const answered = (source: string, over: Partial<ProviderTotal> = {}): ProviderTotal => ({
  source,
  retrieved: 100,
  totalHits: 5000,
  ...over
});

const failed = (source: string): ProviderTotal => ({ source, retrieved: 0, error: 'exceeded the 20000ms budget' });
const skipped = (source: string): ProviderTotal => ({
  source,
  retrieved: 0,
  error: 'skipped: no keywordSearch capability'
});

const banner = () => screen.queryByRole('status');

afterEach(cleanup);

describe('telling a skip from a failure', () => {
  it('warns that the total is a lower bound when a provider did not answer', () => {
    render(<ProviderCoverage providers={[answered('europepmc'), failed('openaire')]} complete={false} />);

    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toContain('This search is incomplete');
    expect(banner()!.textContent).toContain('OpenAIRE');
    expect(banner()!.textContent).toContain('lower bound');
  });

  it('does not warn when the only silent providers were skipped', () => {
    // CORE and DataCite declare `keywordSearch: false`, so a keyword query
    // never asks them. That is not a degraded search.
    render(
      <ProviderCoverage providers={[answered('europepmc'), skipped('core'), skipped('datacite')]} complete />
    );

    expect(banner()).toBeNull();
  });

  it('lists a skipped provider as not searched, with the reason', () => {
    render(<ProviderCoverage providers={[answered('europepmc'), skipped('core')]} complete />);

    expect(screen.getByText(/Not searched for this query/).textContent).toContain('CORE');
    expect(screen.getByText(/Not searched for this query/).textContent).toContain('no keyword index');
  });

  it('warns on complete: false even when no provider carries an error', () => {
    // `complete` is computed from the reports rather than from this list, so
    // the two can disagree; the honest reading is the pessimistic one.
    render(<ProviderCoverage providers={[answered('europepmc')]} complete={false} />);

    expect(banner()!.textContent).toContain('At least one source did not answer');
  });

  it('treats an absent complete as not-known-to-be-degraded', () => {
    // Optional in the response, and a consumer that does not know about it
    // should not be told the search is broken.
    render(<ProviderCoverage providers={[answered('europepmc')]} />);

    expect(banner()).toBeNull();
  });
});

describe('what it shows for a provider that answered', () => {
  it('shows each provider under its own name, not its id', () => {
    render(<ProviderCoverage providers={[answered('ncbi'), answered('europepmc')]} complete />);

    expect(screen.getByText('PubMed')).toBeTruthy();
    expect(screen.getByText('Europe PMC')).toBeTruthy();
  });

  it('falls back to the raw id for a provider it has no label for', () => {
    render(<ProviderCoverage providers={[answered('newsource')]} complete />);

    expect(screen.getByText('newsource')).toBeTruthy();
  });

  it('shows the corpus count beside what this search retrieved', () => {
    render(<ProviderCoverage providers={[answered('europepmc', { totalHits: 5000, retrieved: 600 })]} complete />);

    const row = screen.getByText('Europe PMC').closest('li')!;
    expect(within(row).getByText(/5,000/)).toBeTruthy();
    expect(within(row).getByText(/600/)).toBeTruthy();
  });

  it('orders providers by how much they matched', () => {
    render(
      <ProviderCoverage
        providers={[answered('doaj', { totalHits: 10 }), answered('europepmc', { totalHits: 9000 })]}
        complete
      />
    );

    const names = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(names[0]).toContain('Europe PMC');
  });

  it('shows an em dash rather than a zero when a provider reports no total', () => {
    // `reportsTotal: false` is a fact about the API, not a count of zero.
    render(<ProviderCoverage providers={[{ source: 'biorxiv', retrieved: 30 }]} complete />);

    const row = screen.getByText('bioRxiv').closest('li')!;
    expect(row.textContent).toContain('—');
  });

  it('renders nothing at all when there is nothing to report', () => {
    const { container } = render(<ProviderCoverage providers={[]} complete />);

    expect(container.firstChild).toBeNull();
  });
});
