import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../../orchestrator/registry';
import type { ProviderId } from '@open-access-explorer/shared';

/**
 * Every provider's declared capabilities, pinned.
 *
 * Phase 08's acceptance list asks for capabilities "declared truthfully —
 * especially `yearFilter` and `maxPageSize`", and phase 10's audit found that
 * while each value is argued for in prose, with the measurement that produced
 * it, **not one of them was asserted anywhere**. `yearFilter` could have been
 * flipped to `false` and every test would still pass.
 *
 * That matters because these are not documentation. `plan()` reads
 * `keywordSearch` and `doiLookup` to decide which providers are asked at all,
 * and `maxPageSize` decides how deep a read actually goes — so a wrong value
 * silently changes what a search returns rather than failing.
 *
 * The comment against each row is the evidence, and several of them are
 * corrections that cost real effort to establish. Changing a value here should
 * mean a new measurement, not a guess.
 */

type Expected = {
  keywordSearch: boolean;
  doiLookup: boolean;
  yearFilter: boolean;
  maxPageSize: number;
  reportsTotal: boolean;
  suppliesCitations: boolean;
};

const EXPECTED: Record<ProviderId | string, Expected> = {
  // `submittedDate:[X TO Y]` with two concrete endpoints. The wildcard form the
  // old connector used answers HTTP 500, which its catch-all turned into an
  // empty result — arXiv left every year-filtered search silently.
  // `doiLookup` is false: arXiv has no DOI endpoint, so a lookup is skipped
  // with the missing capability named rather than answered with an empty set.
  arxiv: { keywordSearch: true, doiLookup: false, yearFilter: true, maxPageSize: 2000, reportsTotal: true, suppliesCitations: false },

  // Scans a date window rather than an index, so there is no keyword search and
  // no corpus-wide count to report. 30 is the window it reads.
  biorxiv: { keywordSearch: false, doiLookup: true, yearFilter: false, maxPageSize: 30, reportsTotal: false, suppliesCitations: false },

  // Keyword search off on measured latency, not quality: roughly four in ten
  // keyword searches landed inside the 20s budget. A DOI lookup was inside it
  // every time measured. `yearFilter` is true in the query — `filters` was
  // ignored silently. 25 is a latency ceiling; 50 failed and 100 timed out.
  // Citations exist as a field and were 0 on every record measured.
  core: { keywordSearch: false, doiLookup: true, yearFilter: true, maxPageSize: 25, reportsTotal: true, suppliesCitations: false },

  // Keyword search turned off on evidence — a registry of repository items,
  // returning datasets and software alongside papers.
  datacite: { keywordSearch: false, doiLookup: true, yearFilter: true, maxPageSize: 1000, reportsTotal: true, suppliesCitations: false },

  // `yearFilter` is TRUE, and this is the correction phase 08 recorded: the
  // runbook expected false. Two concrete endpoints work; the wildcard the old
  // connector sent answered HTTP 400.
  doaj: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 100, reportsTotal: true, suppliesCitations: false },

  // The only provider besides OpenAlex that supplies a citation count.
  europepmc: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 1000, reportsTotal: true, suppliesCitations: true },

  ncbi: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 500, reportsTotal: true, suppliesCitations: false },

  openaire: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 100, reportsTotal: true, suppliesCitations: false },

  // 200 is OpenAlex's own per-page cap; the provider paginates internally to
  // reach the requested depth. `publication_year:X-Y` — the `>=`/`<=` form the
  // old path emitted is rejected with HTTP 400.
  openalex: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 200, reportsTotal: true, suppliesCitations: true },

  plos: { keywordSearch: true, doiLookup: true, yearFilter: true, maxPageSize: 1000, reportsTotal: true, suppliesCitations: false }
};

describe('provider capabilities', () => {
  it('covers every registered provider', () => {
    // A provider added to the registry without a row here fails, rather than
    // arriving with its capabilities unasserted.
    expect(PROVIDERS.map(p => p.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  describe.each(PROVIDERS.map(p => [p.id, p] as const))('%s', (id, provider) => {
    const expected = EXPECTED[id];

    it('declares the measured values', () => {
      expect({
        keywordSearch: provider.capabilities.keywordSearch,
        doiLookup: provider.capabilities.doiLookup,
        yearFilter: provider.capabilities.yearFilter,
        maxPageSize: provider.capabilities.maxPageSize,
        reportsTotal: provider.capabilities.reportsTotal,
        suppliesCitations: provider.capabilities.suppliesCitations
      }).toEqual(expected);
    });

    it('can do at least one of the two things a provider is for', () => {
      const { keywordSearch, doiLookup } = provider.capabilities;
      expect(keywordSearch || doiLookup).toBe(true);
    });

    it('names the fields it populates', () => {
      expect(provider.capabilities.fields.length).toBeGreaterThan(0);
    });

    it('claims a citation count only if it also lists the field', () => {
      if (provider.capabilities.suppliesCitations) {
        expect(provider.capabilities.fields).toContain('citationCount');
      }
    });

    /**
     * A declined capability has to say why, and the reason has to be one a
     * reader can be shown — `ProviderCoverage` renders it verbatim.
     *
     * The type cannot require this without becoming a discriminated union that
     * every provider pays for, so it is required here. It is worth requiring
     * because the failure already happened: `keywordSearch: false` was read as
     * "has no keyword index", which is what the field's own comment said, and
     * the panel told readers exactly that about CORE and DataCite — both of
     * which have one. Nobody writing the frontend could have known better,
     * because the reason was not written anywhere it could reach.
     */
    it('says why, for each capability it declines', () => {
      for (const capability of ['keywordSearch', 'doiLookup'] as const) {
        if (provider.capabilities[capability]) continue;

        const reason = provider.capabilities.skipReason?.[capability];

        expect(
          reason,
          `${id} declares \`${capability}: false\` with no \`skipReason\` beside it. ` +
            'The panel shows that reason to readers; without one it falls back to ' +
            'naming the flag, which is not a reason.'
        ).toBeTruthy();

        // Rendered after the provider's name in one muted line, so it is a
        // phrase rather than a sentence.
        expect(reason!.length, `${id}: "${reason}"`).toBeLessThanOrEqual(60);
        expect(reason, id).toBe(reason!.trim());
        expect(reason, `${id} should not end with a full stop`).not.toMatch(/\.$/);
      }
    });
  });

  /**
   * The three that decline a keyword query, and the reason the panel can no
   * longer print one sentence for all of them: one has no index, and the other
   * two have a perfectly good one and are declined for reasons of our own.
   */
  it('does not tell the same story about all three keyword refusals', () => {
    const declining = PROVIDERS.filter(p => !p.capabilities.keywordSearch);
    expect(declining.map(p => p.id).sort()).toEqual(['biorxiv', 'core', 'datacite']);

    const reasons = declining.map(p => p.capabilities.skipReason!.keywordSearch!);

    expect(new Set(reasons).size).toBe(3);
    expect(reasons.filter(r => r.includes('keyword index'))).toHaveLength(1);
  });

  /**
   * What `maxPageSize` actually costs, which is the reason it is worth pinning.
   *
   * `fanOut` asks each provider once and every provider caps the request at its
   * own ceiling, so the depth the orchestrator requests is not the depth it
   * gets. This is the table the runbook records against the default depth of
   * 600 — it is a property of the whole fan-out, and it changes the moment any
   * one of these numbers does.
   */
  it('yields the recorded read depth for a default 600-record request', () => {
    const DEPTH = 600;
    const yielded = Object.fromEntries(
      PROVIDERS.map(p => [p.id, Math.min(DEPTH, p.capabilities.maxPageSize)])
    );

    expect(yielded).toEqual({
      // At or above the requested depth, so they yield all of it.
      europepmc: 600, plos: 600, arxiv: 600, datacite: 600,
      // OpenAlex caps a page at 200 and paginates internally to reach 600.
      openalex: 200,
      ncbi: 500,
      doaj: 100, openaire: 100,
      biorxiv: 30,
      core: 25
    });
  });
});
