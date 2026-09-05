import { describe, it, expect } from 'vitest';
import type { ProviderTotal } from '@open-access-explorer/shared';
import { coverageOf, isFailed, isSkipped, skipsByReason, totalLabel } from '../coverage';

const answered = (source: string, totalHits: number, retrieved: number): ProviderTotal => ({
  source,
  totalHits,
  retrieved
});

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
    const failed: ProviderTotal = { source: 'arxiv', retrieved: 0, error: 'arXiv 429' };
    expect(coverageOf([answered('doaj', 500, 600), failed])).toEqual({ truncated: false });
  });

  it('ignores a source that was skipped', () => {
    const skipped: ProviderTotal = { source: 'core', retrieved: 0, error: 'skipped: too slow to answer in time' };
    expect(coverageOf([answered('ncbi', 900, 600), skipped]).matching).toBe(900);
  });

  it('is absent when no source reports a total at all', () => {
    // bioRxiv declares `reportsTotal: false`. An absent count is not a zero
    // and cannot be compared against what was read.
    expect(coverageOf([{ source: 'biorxiv', retrieved: 30 }])).toEqual({ truncated: false });
  });

  it('is absent when nothing was truncated, since there is no gap to describe', () => {
    expect(coverageOf([answered('plos', 6644, 6644)]).matching).toBeUndefined();
  });

  it('survives an empty report list', () => {
    expect(coverageOf([])).toEqual({ truncated: false });
  });
});


/**
 * A skip travels as a prefixed `error`, because `ProviderTotal` has one field
 * for "why this contributed nothing". The prefix is the only thing separating
 * "we chose not to ask" from "we asked and it broke", so it is tested rather
 * than trusted to three separate `startsWith` calls.
 */
describe('telling a skip from a failure', () => {
  const skipped: ProviderTotal = { source: 'core', retrieved: 0, error: 'skipped: too slow to answer in time' };
  const broke: ProviderTotal = { source: 'arxiv', retrieved: 0, error: 'arXiv 429' };
  const fine: ProviderTotal = { source: 'ncbi', retrieved: 600, totalHits: 900 };

  it('reads the prefix, and only the prefix', () => {
    expect([isSkipped(skipped), isSkipped(broke), isSkipped(fine)]).toEqual([true, false, false]);
    expect([isFailed(skipped), isFailed(broke), isFailed(fine)]).toEqual([false, true, false]);
  });

  it('does not mistake a failure that merely mentions the word', () => {
    // A provider's own error text is not ours to parse. Only the prefix we
    // wrote counts.
    const awkward: ProviderTotal = { source: 'doaj', retrieved: 0, error: 'request was skipped: upstream 503' };
    expect(isSkipped(awkward)).toBe(false);
    expect(isFailed(awkward)).toBe(true);
  });
});

describe('grouping skips by the reason they gave', () => {
  const skip = (source: string, reason: string): ProviderTotal => ({
    source,
    retrieved: 0,
    error: `skipped: ${reason}`
  });

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
        { source: 'ncbi', retrieved: 600, totalHits: 900 },
        { source: 'arxiv', retrieved: 0, error: 'arXiv 429' },
        skip('core', 'too slow to answer in time')
      ])
    ).toEqual([{ reason: 'too slow to answer in time', sources: ['core'] }]);
  });

  it('is empty when nothing was skipped', () => {
    expect(skipsByReason([{ source: 'ncbi', retrieved: 600, totalHits: 900 }])).toEqual([]);
  });
});


/**
 * The sentence the header shows, which is the whole point of the rest of this
 * file. It used to read "N retrievable open-access papers" whatever N was a
 * count of.
 */
describe('saying what the count is', () => {
  it('names both numbers when the read was cut short', () => {
    expect(totalLabel(1716, { truncated: true, matching: 684999 }))
      .toBe('1,716 retrieved of 684,999+ matching');
  });

  it('says only what was retrieved when no source reported a corpus count', () => {
    // bioRxiv alone, say: read short, with nothing to compare against.
    expect(totalLabel(30, { truncated: true })).toBe('30 retrieved');
  });

  it('says it plainly when every source was read to the end', () => {
    expect(totalLabel(53, { truncated: false })).toBe('53 open-access papers');
  });

  it('says one paper in the singular', () => {
    // A DOI lookup matches one, and the header read "1 retrievable open-access
    // papers" for as long as the old wording stood.
    expect(totalLabel(1, { truncated: false })).toBe('1 open-access paper');
  });

  it('groups the digits, because these run to seven of them', () => {
    expect(totalLabel(2891, { truncated: true, matching: 4636103 }))
      .toBe('2,891 retrieved of 4,636,103+ matching');
  });
});
