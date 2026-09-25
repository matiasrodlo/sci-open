import { describe, it, expect } from 'vitest';
import type { ProviderTotal } from '@open-access-explorer/shared';
import {
  countLabel, coverageOf, filtersNarrow, isFailed, isSkipped, matchingNote, matchingOf, skipsByReason,
  sourceCountsApply, totalLabel
} from '../coverage';

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

describe('whether the sources count the question that was asked', () => {
  it('does for a plain keyword search', () => {
    expect(sourceCountsApply('crispr cas9', {})).toBe(true);
  });

  it('does with a year range, which every counting source applies upstream', () => {
    expect(sourceCountsApply('crispr', { yearFrom: 2020, yearTo: 2024, openAccessOnly: true })).toBe(true);
  });

  it('does not once a facet narrows what was read', () => {
    expect(sourceCountsApply('crispr', { venue: ['Nature'] })).toBe(false);
    expect(sourceCountsApply('crispr', { year: ['2021'] })).toBe(false);
    expect(sourceCountsApply('crispr', { publicationType: ['preprint'] })).toBe(false);
  });

  it('ignores a facet that is present but empty', () => {
    expect(sourceCountsApply('crispr', { venue: [] })).toBe(true);
  });

  /**
   * OpenAIRE is asked `crispr` for `AU=Doudna AND crispr`, and arXiv has no
   * `NOT`. Their counts are of a wider question, so `#1 NOT #3` would show the
   * same size as `#1` — the narrowing the history's counts exist to reveal.
   */
  it('does not for a query some sources widen', () => {
    expect(sourceCountsApply('AU=Doudna AND crispr', {})).toBe(false);
    expect(sourceCountsApply('crispr NOT cas9', {})).toBe(false);
    expect(sourceCountsApply('crispr OR talen', {})).toBe(false);
  });

  it('does not when the query cannot be parsed here, rather than guess', () => {
    expect(sourceCountsApply('(crispr', {})).toBe(false);
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
