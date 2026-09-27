import { describe, it, expect } from 'vitest';
import type { ProviderId, ProviderReport } from '@open-access-explorer/shared';
import {
  countLabel, coverageOf, filtersNarrow, isFailed, isSkipped, matchingNote, matchingOf, skipsByReason, totalLabel
} from '../coverage';

const report = (provider: ProviderId, over: Partial<ProviderReport> = {}): ProviderReport => ({
  provider,
  status: 'ok',
  retrieved: 0,
  latency: 0,
  ...over
});

const answered = (provider: ProviderId, totalHits: number, retrieved: number) => report(provider, { totalHits, retrieved });
const failed = (provider: ProviderId, error: string) => report(provider, { status: 'error', error });
const skip = (provider: ProviderId, reason: string) => report(provider, { status: 'skipped', skipReason: reason });

describe('whether the total is a window or an answer', () => {
  it('is a window when a source held more than was read from it', () => {
    // The shape of every broad search: 600 read, hundreds of thousands there.
    expect(coverageOf([answered('openaire', 684999, 600)])).toEqual({
      truncated: true,
      matching: 684999
    });
  });

  it('is an answer when every source was read to the end', () => {
    expect(coverageOf([answered('doaj', 12, 12), answered('plos', 4, 4)])).toEqual({
      truncated: false
    });
  });

  it('is a window if any one source was cut short', () => {
    expect(coverageOf([answered('doaj', 12, 12), answered('ncbi', 900, 600)]).truncated).toBe(true);
  });
});

describe('the floor on how many match', () => {
  it('is the largest source, never the sum', () => {
    // The corpora overlap — Europe PMC indexes all of PubMed — so adding these
    // would count the same paper twice and claim more than is there.
    const { matching } = coverageOf([
      answered('openaire', 684999, 600),
      answered('ncbi', 287637, 600),
      answered('doaj', 109605, 600)
    ]);

    expect(matching).toBe(684999);
  });

  it('ignores a source that failed, which reports no total to raise it', () => {
    expect(coverageOf([answered('doaj', 500, 600), failed('arxiv', 'arXiv 429')])).toEqual({ truncated: false });
  });

  it('ignores a source that was skipped', () => {
    expect(coverageOf([answered('ncbi', 900, 600), skip('core', 'too slow to answer in time')]).matching).toBe(900);
  });

  it('ignores a count from a source that timed out after giving one', () => {
    // Status decides, not the presence of a number: a report is only an
    // answer when it says it is one.
    expect(coverageOf([answered('ncbi', 900, 600), report('openaire', { status: 'timeout', totalHits: 684999, retrieved: 100, error: 'timeout' })]).matching).toBe(900);
  });

  it('is absent when no source reports a total at all', () => {
    // bioRxiv declares `reportsTotal: false`. An absent count is not a zero
    // and cannot be compared against what was read.
    expect(coverageOf([report('biorxiv', { retrieved: 30 })])).toEqual({ truncated: false });
  });

  it('is absent when nothing was truncated, since there is no gap to describe', () => {
    expect(coverageOf([answered('plos', 6644, 6644)]).matching).toBeUndefined();
  });

  it('survives an empty report list', () => {
    expect(coverageOf([])).toEqual({ truncated: false });
  });
});


/**
 * "We chose not to ask" and "we asked and it broke" are different statements,
 * and only the second makes the total a lower bound. Version 1 of the response
 * told them apart by a `skipped: ` prefix on `error`; version 2 has a status.
 */
describe('telling a skip from a failure', () => {
  const skipped = skip('core', 'too slow to answer in time');
  const broke = failed('arxiv', 'arXiv 429');
  const slow = report('europepmc', { status: 'timeout', error: 'timeout of 20000ms exceeded' });
  const fine = answered('ncbi', 900, 600);

  it('reads the status', () => {
    expect([isSkipped(skipped), isSkipped(broke), isSkipped(slow), isSkipped(fine)]).toEqual([true, false, false, false]);
    expect([isFailed(skipped), isFailed(broke), isFailed(slow), isFailed(fine)]).toEqual([false, true, true, false]);
  });

  it('does not mistake a failure whose message merely mentions skipping', () => {
    // A provider's own error text is not ours to parse.
    const awkward = failed('doaj', 'skipped: upstream 503');
    expect(isSkipped(awkward)).toBe(false);
    expect(isFailed(awkward)).toBe(true);
  });
});

describe('grouping skips by the reason they gave', () => {
  it('keeps three different reasons apart', () => {
    // The whole point: the three providers that decline a keyword query do so
    // for three different reasons, and only one of them is "no keyword index".
    expect(
      skipsByReason([
        skip('biorxiv', 'no keyword index'),
        skip('core', 'too slow to answer in time'),
        skip('datacite', 'no retrievable copies to contribute')
      ])
    ).toEqual([
      { reason: 'no keyword index', sources: ['biorxiv'] },
      { reason: 'too slow to answer in time', sources: ['core'] },
      { reason: 'no retrievable copies to contribute', sources: ['datacite'] }
    ]);
  });

  it('collects everyone who gave the same reason', () => {
    expect(skipsByReason([skip('arxiv', 'no DOI index'), skip('plos', 'no DOI index')])).toEqual([
      { reason: 'no DOI index', sources: ['arxiv', 'plos'] }
    ]);
  });

  it('ignores providers that answered or failed', () => {
    expect(
      skipsByReason([
        answered('ncbi', 900, 600),
        failed('arxiv', 'arXiv 429'),
        skip('core', 'too slow to answer in time')
      ])
    ).toEqual([{ reason: 'too slow to answer in time', sources: ['core'] }]);
  });

  it('is empty when nothing was skipped', () => {
    expect(skipsByReason([answered('ncbi', 900, 600)])).toEqual([]);
  });

  it('still names a source whose skip came without a reason', () => {
    expect(skipsByReason([report('core', { status: 'skipped' })])).toEqual([
      { reason: 'no reason given', sources: ['core'] }
    ]);
  });
});


/**
 * The count the page shows for a search — header, history and pagination — and
 * the reason this file exists. It used to lead with what this search read,
 * "1,716 retrieved of 684,999+ matching", and the read is the half that moves
 * with how many sources answered.
 */
describe('how many match', () => {
  const cutShort = { truncated: true, matching: 684999 };

  it('is the largest source when the read was cut short', () => {
    expect(matchingOf(1716, cutShort, true)).toEqual({ count: 684999, basis: 'source' });
  });

  it('is the whole set when every source was read to the end', () => {
    expect(matchingOf(53, { truncated: false }, true)).toEqual({ count: 53, basis: 'exact' });
  });

  it('falls back to the read when the sources cannot count the question', () => {
    // A facet ticked, or a field tag some source widened away. The read has
    // been narrowed; the sources' counts have not.
    expect(matchingOf(80, cutShort, false)).toEqual({ count: 80, basis: 'read' });
  });

  it('never names fewer than were read', () => {
    // Three sources of ~700 each, read to 600, can hold more between them than
    // the largest one reports — and pagination would then walk past the count.
    expect(matchingOf(1100, { truncated: true, matching: 900 }, true)).toEqual({ count: 1100, basis: 'read' });
  });

  it('is still a floor when no source gave a count to use', () => {
    expect(matchingOf(30, { truncated: true }, true)).toEqual({ count: 30, basis: 'read' });
  });
});

describe('telling a facet from a bound the sources apply', () => {
  it('counts only the filters applied after the fan-out', () => {
    expect(filtersNarrow({ yearFrom: 2020, openAccessOnly: true })).toBe(false);
    expect(filtersNarrow({ oaStatus: ['gold'] })).toBe(true);
    expect(filtersNarrow({ source: ['arxiv'] })).toBe(true);
  });
});

describe('saying what the count is', () => {
  it('says a floor with its plus, as matching', () => {
    expect(totalLabel({ count: 684999, basis: 'source' })).toBe('684,999+ matching papers');
    expect(totalLabel({ count: 80, basis: 'read' })).toBe('80+ matching papers');
  });

  it('never names what was retrieved', () => {
    expect(totalLabel(matchingOf(1716, { truncated: true, matching: 684999 }, true))).not.toMatch(/1,716|retrieved/);
  });

  it('says it plainly when every source was read to the end', () => {
    expect(totalLabel({ count: 53, basis: 'exact' })).toBe('53 open-access papers');
  });

  it('says one paper in the singular', () => {
    // A DOI lookup matches one, and the header read "1 retrievable open-access
    // papers" for as long as an older wording stood.
    expect(totalLabel({ count: 1, basis: 'exact' })).toBe('1 open-access paper');
  });

  it('groups the digits, because these run to seven of them', () => {
    expect(countLabel({ count: 4636103, basis: 'source' })).toBe('4,636,103+');
    expect(countLabel({ count: 2891, basis: 'exact' })).toBe('2,891');
  });

  it('explains the plus, and has nothing to explain without one', () => {
    expect(matchingNote({ count: 684999, basis: 'source' })).toContain('largest single source');
    expect(matchingNote({ count: 80, basis: 'read' })).toContain('fixed depth');
    expect(matchingNote({ count: 53, basis: 'exact' })).toBeUndefined();
  });
});
