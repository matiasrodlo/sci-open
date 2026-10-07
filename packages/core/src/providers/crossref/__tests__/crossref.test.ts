import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Query } from '@sci-open/shared';

const { lookupDoi, fetchPage } = vi.hoisted(() => ({ lookupDoi: vi.fn(), fetchPage: vi.fn() }));
vi.mock('../../../authorities/crossref/fetch', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../authorities/crossref/fetch')>()),
  lookupDoi
}));
vi.mock('../fetch', async importOriginal => ({ ...(await importOriginal<typeof import('../fetch')>()), fetchPage }));

import { translate } from '../translate';
import { normalize } from '../normalize';
import { search } from '../index';
import { plan } from '../../../orchestrator/plan';
import { PROVIDERS } from '../../../orchestrator/registry';
import { parseQuery } from '../../../orchestrator/parse-query';

const RECORDED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../__fixtures__/works.json'), 'utf8'));
const AT = '2026-10-07T00:00:00.000Z';
const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });
const params = (native: string) => Object.fromEntries(new URLSearchParams(native));

beforeEach(() => {
  lookupDoi.mockReset();
  fetchPage.mockReset();
});

describe('translate', () => {
  it('asks for the words in the field Crossref built for matching citations', () => {
    expect(params(translate(query({ terms: ['market', 'lemons'], phrases: ['quality uncertainty'] }))))
      .toEqual({ 'query.bibliographic': 'market lemons quality uncertainty' });
  });

  it('bounds the years by publication date', () => {
    expect(params(translate(query({ terms: ['graphene'], years: { from: 2008, to: 2010 } }))))
      .toEqual({ 'query.bibliographic': 'graphene', filter: 'from-pub-date:2008,until-pub-date:2010' });
  });

  it('sends author and venue clauses to their own fields, and no word a NOT leaves out', () => {
    const native = params(translate(parseQuery('AU=Akerlof AND SO="Quarterly Journal" AND lemons NOT cars')));
    expect(native).toEqual({ 'query.bibliographic': 'lemons', 'query.author': 'Akerlof', 'query.container-title': 'Quarterly Journal' });
  });

  it('looks a DOI up by itself, and asks nothing of a year alone', () => {
    expect(translate(query({ doi: '10.1086/225469' }))).toBe('doi:10.1086/225469');
    expect(translate(query({ years: { from: 2020 } }))).toBe('');
  });
});

describe('normalize', () => {
  const { papers, skipped } = normalize(RECORDED.list.message.items, { retrievedAt: AT });

  it('gives the title with its subtitle, which Crossref keeps apart', () => {
    // OpenAlex's record titles this paper "False-Positive Psychology" alone.
    expect(papers[0]).toMatchObject({
      id: 'crossref:10.1177/0956797611417632',
      doi: '10.1177/0956797611417632',
      title: 'False-Positive Psychology: Undisclosed Flexibility in Data Collection and Analysis Allows Presenting Anything as Significant',
      year: 2011,
      venue: 'Psychological Science',
      biblio: { volume: '22', firstPage: '1359', lastPage: '1366' },
      stage: 'published',
      sources: [{ provider: 'crossref', nativeId: '10.1177/0956797611417632', rank: 0, retrievedAt: AT }]
    });
  });

  it('says nothing of access, which Crossref does not report', () => {
    expect(papers.every(p => p.oaStatus === 'unknown')).toBe(true);
  });

  it('marks a paper retracted when a retraction updates it, and not for a correction', () => {
    // Wakefield et al. 1998: a correction in 2004, the retraction in 2010,
    // both from Retraction Watch's data as Crossref carries it.
    const [retracted] = normalize([RECORDED.retracted.message], { retrievedAt: AT }).papers;
    expect(retracted).toMatchObject({ doi: '10.1016/s0140-6736(97)11096-0', retracted: true });
    const corrected = { ...RECORDED.retracted.message, 'updated-by': RECORDED.retracted.message['updated-by'].filter((u: { type: string }) => u.type === 'correction') };
    expect(normalize([corrected], { retrievedAt: AT }).papers[0]).not.toHaveProperty('retracted');
    expect(papers.some(p => p.retracted)).toBe(false);
  });

  it('skips a record with no DOI or no title, saying which', () => {
    expect(papers.map(p => p.doi)).toEqual(['10.1177/0956797611417632', '10.1086/225469', '10.1145/359340.359342']);
    expect(skipped).toEqual([{ index: 3, reason: 'no DOI' }, { index: 4, nativeId: '10.1000/untitled', reason: 'no title' }]);
  });
});

describe('search', () => {
  it('reads a DOI from the single-record endpoint, not a list', async () => {
    lookupDoi.mockResolvedValue(RECORDED.single);
    const { papers } = await search(query({ doi: '10.1145/1327452.1327492' }), { timeoutMs: 1000, openAccessOnly: false });
    expect(lookupDoi).toHaveBeenCalledWith('10.1145/1327452.1327492', { timeoutMs: 1000 });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(papers[0]).toMatchObject({ title: 'MapReduce: simplified data processing on large clusters', citationCount: expect.any(Number) });
  });

  it('pages a search from the offset, capped at a thousand rows', async () => {
    fetchPage.mockResolvedValue(RECORDED.list);
    const { papers } = await search(query({ terms: ['ties'] }), { timeoutMs: 1000, pageSize: 5000, offset: 20, openAccessOnly: false });
    expect(fetchPage.mock.calls[0]![1]).toMatchObject({ pageSize: 1000, offset: 20 });
    expect(papers[1]!.sources[0]!.rank).toBe(21);
  });
});

describe('the plan', () => {
  const crossref = PROVIDERS.filter(p => p.id === 'crossref');

  it('leaves Crossref out of an open-access search, saying why, and asks it otherwise', () => {
    const q = parseQuery('strength weak ties');
    expect(plan(q, crossref, { openAccessOnly: true })).toMatchObject({
      planned: [], skipped: [{ provider: 'crossref', reason: 'reports no access status to filter on' }]
    });
    expect(plan(q, crossref, { openAccessOnly: false }).planned).toHaveLength(1);
  });

  it('asks it about a DOI either way', () => {
    expect(plan(parseQuery('10.1086/225469'), crossref, { openAccessOnly: true }).planned).toHaveLength(1);
  });
});
