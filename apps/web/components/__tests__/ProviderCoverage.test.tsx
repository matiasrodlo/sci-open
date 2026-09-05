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
 * A provider that was *skipped* declined to guess, and said why — the reason
 * comes from `ProviderCapabilities.skipReason` and is shown verbatim. A
 * provider that *failed* was asked and did not answer, and only that makes the
 * total a lower bound. Reporting a skip as a failure is the bug phase 08 fixed
 * in the comparison sweep, and it would be the same bug here.
 */

const answered = (source: string, over: Partial<ProviderTotal> = {}): ProviderTotal => ({
  source,
  retrieved: 100,
  totalHits: 5000,
  ...over
});

const failed = (source: string): ProviderTotal => ({ source, retrieved: 0, error: 'exceeded the 20000ms budget' });
const skipped = (source: string, reason = 'no keyword index'): ProviderTotal => ({
  source,
  retrieved: 0,
  error: `skipped: ${reason}`
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

  it('lists a skipped provider as not searched, with the reason it was given', () => {
    render(
      <ProviderCoverage
        providers={[answered('europepmc'), skipped('core', 'too slow to answer in time')]}
        complete
      />
    );

    const line = screen.getByText(/Not searched for this query/).textContent!;
    expect(line).toContain('CORE');
    expect(line).toContain('too slow to answer in time');
  });

  /**
   * The panel used to print "no keyword index for it" for every skip. It is
   * true of bioRxiv and false of CORE, which has one and is too slow, and of
   * DataCite, which has one and returns nothing readable. Three providers, one
   * sentence, two lies — and nothing at this end could have known better,
   * because the reason lived in the capability files.
   */
  it('does not invent a reason of its own', () => {
    render(
      <ProviderCoverage
        providers={[
          answered('europepmc'),
          skipped('core', 'too slow to answer in time'),
          skipped('datacite', 'no retrievable copies to contribute')
        ]}
        complete
      />
    );

    expect(screen.getByText(/Not searched for this query/).textContent).not.toContain('keyword index');
  });

  it('names each reason once, with everyone it applies to', () => {
    // Six providers decline a DOI query between them for one reason. Six lines
    // saying the same thing is worse than one line naming six providers.
    render(
      <ProviderCoverage
        providers={[answered('europepmc'), skipped('core', 'no DOI index'), skipped('plos', 'no DOI index')]}
        complete
      />
    );

    const line = screen.getByText(/Not searched for this query/).textContent!;
    expect(line).toContain('CORE, PLOS');
    expect(line.match(/no DOI index/g)).toHaveLength(1);
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

/**
 * A count can be short with every source having answered.
 *
 * The rescue asks about the papers the open-access gate would drop, bounded in
 * number and in time, and drops the rest unasked. `complete` cannot say this —
 * it is computed from the provider reports, and they are all fine — so a reader
 * was shown a bounded total with nothing to mark it as one.
 */
describe('a total bounded by the rescue rather than by a source', () => {
  it('warns, without claiming a source failed', () => {
    render(<ProviderCoverage providers={[answered('europepmc')]} complete bounded />);

    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toContain('This count is a lower bound');
    expect(banner()!.textContent).toContain('retrievable copy');
    // The wording for the other cause would be a lie here.
    expect(banner()!.textContent).not.toContain('did not answer');
    expect(banner()!.textContent).not.toContain('This search is incomplete');
  });

  it('reports both when both happened, rather than the first of the two', () => {
    // They are independent: a source gap is a hole in the corpus, a bounded
    // rescue is a hole in what was asked about the papers that did arrive. An
    // if/else chain showed only the source, and the rescue's shortfall appears
    // nowhere else in the response.
    render(
      <ProviderCoverage
        providers={[answered('europepmc'), failed('openaire')]}
        complete={false}
        bounded
      />
    );

    const text = banner()!.textContent!;
    expect(text).toContain('This search is incomplete');
    expect(text).toContain('OpenAIRE');
    expect(text).toContain('retrievable copy');
    // "Every source answered, but…" is the wording for the other case, and it
    // is false beside a source that did not.
    expect(text).not.toContain('Every source answered');
  });

  it('stays silent when the rescue was not bounded', () => {
    render(<ProviderCoverage providers={[answered('europepmc')]} complete bounded={false} />);

    expect(banner()).toBeNull();
  });

  it('treats an absent bounded as not-known-to-be-bounded', () => {
    render(<ProviderCoverage providers={[answered('europepmc')]} complete />);

    expect(banner()).toBeNull();
  });
});

/**
 * The number in the header is `depth × providers that answered`, less
 * duplicates and less what the gates dropped — measured on `ai` as 1,716 with
 * three sources up and 2,891 with five, minutes apart. The panel is where a
 * reader can see that per source; this line is what connects it to the total.
 *
 * Deliberately not in the amber banner: a truncated read is the normal state of
 * a broad search, and a warning shown on the normal case teaches people to
 * ignore warnings.
 */
describe('saying what the total is a total of', () => {
  it('says the read was cut short when a source held more than was read', () => {
    render(<ProviderCoverage providers={[answered('openaire', { totalHits: 684999, retrieved: 600 })]} complete />);

    expect(screen.getByText(/read to a fixed depth/).textContent).toContain('not everything that matches');
    // Not an alarm — nothing failed.
    expect(banner()).toBeNull();
  });

  it('stays quiet when every source was read to the end', () => {
    // A query narrow enough to exhaust its sources really does have a complete
    // count, and saying otherwise would be its own kind of lie.
    render(<ProviderCoverage providers={[answered('doaj', { totalHits: 12, retrieved: 12 })]} complete />);

    expect(screen.queryByText(/read to a fixed depth/)).toBeNull();
  });

  it('says it alongside a failure, since the two shorten the count differently', () => {
    render(
      <ProviderCoverage
        providers={[answered('openaire', { totalHits: 684999, retrieved: 600 }), failed('arxiv')]}
        complete={false}
      />
    );

    expect(banner()!.textContent).toContain('arXiv');
    expect(screen.getByText(/read to a fixed depth/)).toBeTruthy();
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
