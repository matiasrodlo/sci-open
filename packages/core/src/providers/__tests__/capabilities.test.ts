import { describe, it, expect } from 'vitest';
import { PROVIDERS } from '../../orchestrator/registry';
import type { ProviderId } from '@sci-open/shared';

/**
 * Every provider's declared capabilities, pinned.
 *
 * Phase 08's acceptance list asks for capabilities "declared truthfully", and
 * phase 10's audit found that while each value is argued for in prose, with
 * the measurement that produced it, **not one of them was asserted anywhere**.
 * Any of them could have been flipped and every test would still pass.
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
  fieldedSearch: boolean;
  doiLookup: boolean;
  maxPageSize: number;
  reportsTotal: boolean;
};

const EXPECTED: Record<ProviderId | string, Expected> = {
  // `doiLookup` is false: arXiv has no DOI endpoint, so a lookup is skipped
  // with the missing capability named rather than answered with an empty set.
  arxiv: { keywordSearch: true, fieldedSearch: true, doiLookup: false, maxPageSize: 2000, reportsTotal: true },

  // Scans a date window rather than an index, so there is no keyword search and
  // no corpus-wide count to report. 30 is the window it reads.
  biorxiv: { keywordSearch: false, fieldedSearch: false, doiLookup: true, maxPageSize: 30, reportsTotal: false },

  // Keyword search off on measured latency, not quality: roughly four in ten
  // keyword searches landed inside the 20s budget. A DOI lookup was inside it
  // every time measured. 25 is a latency ceiling; 50 failed and 100 timed out.
  core: { keywordSearch: false, fieldedSearch: false, doiLookup: true, maxPageSize: 25, reportsTotal: true },

  // Keyword search turned off on evidence — a registry of repository items,
  // returning datasets and software alongside papers.
  datacite: { keywordSearch: false, fieldedSearch: false, doiLookup: true, maxPageSize: 1000, reportsTotal: true },

  doaj: { keywordSearch: true, fieldedSearch: true, doiLookup: true, maxPageSize: 100, reportsTotal: true },

  europepmc: { keywordSearch: true, fieldedSearch: true, doiLookup: true, maxPageSize: 1000, reportsTotal: true },

  ncbi: { keywordSearch: true, fieldedSearch: true, doiLookup: true, maxPageSize: 500, reportsTotal: true },

  openaire: { keywordSearch: true, fieldedSearch: false, doiLookup: true, maxPageSize: 100, reportsTotal: true },

  // 200 is OpenAlex's own per-page cap; the provider paginates internally to
  // reach the requested depth.
  // `fieldedSearch` is TRUE, against the comment that used to sit here saying
  // OpenAlex could not scope a field. It has a `*.search` filter for the title,
  // the abstract, the topic and the author — measured 2026-09-30 — and only
  // `SO=`/`PU=` have none, which widen. See `FIELD_FILTERS` in its translate.
  openalex: { keywordSearch: true, fieldedSearch: true, doiLookup: true, maxPageSize: 200, reportsTotal: true },

  plos: { keywordSearch: true, fieldedSearch: true, doiLookup: true, maxPageSize: 1000, reportsTotal: true }
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
        fieldedSearch: provider.capabilities.fieldedSearch,
        doiLookup: provider.capabilities.doiLookup,
        maxPageSize: provider.capabilities.maxPageSize,
        reportsTotal: provider.capabilities.reportsTotal
      }).toEqual(expected);
    });

    it('can do at least one of the two things a provider is for', () => {
      const { keywordSearch, doiLookup } = provider.capabilities;
      expect(keywordSearch || doiLookup).toBe(true);
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
      // `fieldedSearch` joins the list because `plan` skips on it the same way
      // and `ProviderCoverage` renders its reason the same way — a provider
      // dropped from a fielded search with no reason beside it is the exact
      // failure the other two are here to prevent.
      for (const capability of ['keywordSearch', 'doiLookup', 'fieldedSearch'] as const) {
        if (provider.capabilities[capability]) continue;

        // `fieldedSearch` is only ever reached for a provider that keyword
        // searches: `plan` returns on `keywordSearch: false` before it looks.
        // Demanding a reason for a skip that cannot happen would be asking for
        // a sentence no reader will ever see.
        if (capability === 'fieldedSearch' && !provider.capabilities.keywordSearch) continue;

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

/**
 * Which publication types each provider holds, whether it can be asked for
 * one, and which facets it can count across everything it matches.
 *
 * `plan` skips a provider holding none of the types ticked, so a wrong `holds`
 * silently drops a source from a search; and `filter` decides whether its
 * counts can be trusted under a ticked type. The reasons are in each
 * provider's `capabilities.ts`.
 */
const STAGES_AND_FACETS: Record<string, { holds: string[]; filter: boolean; facets: string[] }> = {
  arxiv: { holds: ['preprint'], filter: false, facets: ['stage'] },
  biorxiv: { holds: ['preprint'], filter: false, facets: [] },
  core: { holds: ['unknown'], filter: false, facets: [] },
  datacite: { holds: ['preprint', 'published', 'unknown'], filter: false, facets: [] },
  doaj: { holds: ['published'], filter: false, facets: ['year', 'stage'] },
  europepmc: { holds: ['preprint', 'published', 'unknown'], filter: true, facets: ['year', 'stage'] },
  ncbi: { holds: ['published', 'unknown'], filter: true, facets: ['year', 'stage'] },
  openaire: { holds: ['published', 'unknown'], filter: true, facets: ['year', 'stage'] },
  openalex: { holds: ['preprint', 'published', 'unknown'], filter: true, facets: ['year', 'stage', 'venue', 'publisher', 'topics'] },
  plos: { holds: ['published'], filter: false, facets: ['year', 'stage', 'venue', 'publisher'] }
};

describe('publication types and counted facets', () => {
  it.each(PROVIDERS.map(p => [p.id, p] as const))('%s', (id, provider) => {
    const { stages, facets } = provider.capabilities;
    expect({ holds: [...stages.holds], filter: stages.filter, facets: [...facets] }).toEqual(STAGES_AND_FACETS[id]);
  });

  it.each(PROVIDERS.map(p => [p.id, p] as const))('%s counts only if it can', (_, provider) => {
    // A facet declared with nothing to count it is a facet silently left out.
    if (provider.capabilities.facets.length > 0) expect(provider.facets).toBeTypeOf('function');
  });
});
