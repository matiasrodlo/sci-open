import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client resolves every status below 500 rather than throwing, so
// the status is read from the response. Every response below is resolved, as
// the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchPage, fetchFacets, HalUnavailableError } from '../fetch';
import { facets, lookup } from '../index';
import type { Query } from '@open-access-explorer/shared';

const RECORDED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../__fixtures__/hal.json'), 'utf8'));

const options = { pageSize: 10, offset: 0, timeoutMs: 1000 };
const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });
const sent = (call = 0): URLSearchParams => get.mock.calls[call]![1].params;
const query = (over: Partial<Query>): Query => ({ terms: ['crispr'], phrases: [], join: 'AND', ...over });

// Braces deliberately: `mockReset()` returns the mock, and an arrow with an
// expression body hands that back to Vitest, which calls it as a teardown.
beforeEach(() => {
  get.mockReset();
});

describe('fetchPage', () => {
  it('returns a page that carries its docs', async () => {
    get.mockResolvedValue(resolved(200, RECORDED));
    expect(await fetchPage('title_t:crispr', options)).toEqual(RECORDED);
  });

  it('reads only open files, of the types `STAGES` names, and no data management plans', async () => {
    get.mockResolvedValue(resolved(200, RECORDED));
    await fetchPage('title_t:crispr', options);

    expect(sent().get('fq')).toBe(
      'submitType_s:file AND openAccess_bool:true AND docType_s:(ART OR COMM OR COUV OR OUV OR REPORT OR UNDEFINED) AND NOT docSubType_s:DMP'
    );
  });

  it('asks for the page it was given', async () => {
    get.mockResolvedValue(resolved(200, RECORDED));
    await fetchPage('title_t:crispr', { ...options, pageSize: 600, offset: 40 });

    expect(sent().get('q')).toBe('title_t:crispr');
    expect(sent().get('rows')).toBe('600');
    expect(sent().get('start')).toBe('40');
    expect(sent().get('fl')).toContain('fileMain_s');
    expect(sent().get('fl')).toContain('openAccess_bool');
  });

  it('carries the status of an HTTP failure', async () => {
    get.mockResolvedValue(resolved(404, ''));

    const error = await fetchPage('title_t:crispr', options).catch(e => e);
    expect(error).toBeInstanceOf(HalUnavailableError);
    expect(error).toMatchObject({ status: 404, message: 'HAL returned no search response: HTTP 404' });
  });

  /**
   * HAL answers a query its parser refuses with 200 and this body — the same
   * message for every fault, measured on `[crispr]`, `crispr{}`, `a:b` and
   * `-crispr`. Nothing in it says the query was at fault, so it carries no
   * status, and the fan-out counts it as a failure to answer.
   */
  it('reads an error body as a failure, carrying no status', async () => {
    get.mockResolvedValue(resolved(200, { error: { msg: 'Error. See help : /docs' } }));

    const error = await fetchPage('title_t:[crispr]', options).catch(e => e);
    expect(error).toBeInstanceOf(HalUnavailableError);
    expect(error.status).toBeUndefined();
    expect(error.message).toContain('Error. See help');
  });

  it('reads a 200 that is not a result page as a failure', async () => {
    get.mockResolvedValue(resolved(200, { unexpected: true }));

    const error = await fetchPage('title_t:crispr', options).catch(e => e);
    expect(error).toBeInstanceOf(HalUnavailableError);
    expect(error.status).toBeUndefined();
  });
});

describe('lookup', () => {
  it('asks for the id on its own field, through the same filter as a search', async () => {
    get.mockResolvedValue(resolved(200, { response: { numFound: 1, docs: [RECORDED.response.docs[0]] } }));

    const paper = await lookup('hal-04020890', { timeoutMs: 1000 });

    expect(sent().get('q')).toBe('halId_s:"hal-04020890"');
    expect(sent().get('fq')).toContain('openAccess_bool:true');
    expect(paper?.id).toBe('hal:hal-04020890');
  });

  it('answers null for an id the filter does not admit', async () => {
    // A thesis, or a file since put under embargo, matches nothing.
    get.mockResolvedValue(resolved(200, { response: { numFound: 0, docs: [] } }));

    expect(await lookup('tel-00000006', { timeoutMs: 1000 })).toBeNull();
  });

  it('answers null rather than another record', async () => {
    get.mockResolvedValue(resolved(200, { response: { numFound: 1, docs: [RECORDED.response.docs[1]] } }));

    expect(await lookup('hal-04020890', { timeoutMs: 1000 })).toBeNull();
  });
});

describe('fetchFacets', () => {
  it('counts every field asked for in one request, reading no records', async () => {
    get.mockResolvedValue(resolved(200, { response: { numFound: 3 }, facet_counts: { facet_fields: {} } }));

    await fetchFacets('title_t:crispr', { timeoutMs: 1000, fields: ['producedDateY_i', 'journalTitle_s'] });

    expect(get).toHaveBeenCalledTimes(1);
    expect(sent().get('rows')).toBe('0');
    expect(sent().getAll('facet.field')).toEqual(['producedDateY_i', 'journalTitle_s']);
    expect(sent().get('f.producedDateY_i.facet.limit')).toBe('-1');
    expect(sent().get('f.journalTitle_s.facet.limit')).toBe('25');
    expect(sent().get('fq')).toContain('submitType_s:file');
  });

  it('reads a facet response with no count as a failure', async () => {
    get.mockResolvedValue(resolved(200, {}));

    await expect(fetchFacets('title_t:crispr', { timeoutMs: 1000, fields: [] })).rejects.toBeInstanceOf(HalUnavailableError);
  });
});

describe('facets', () => {
  const FACETS = {
    response: { numFound: 120 },
    facet_counts: {
      facet_fields: {
        producedDateY_i: ['2024', 50, '2023', 40, '0', 3],
        docType_s: ['ART', 70, 'UNDEFINED', 20, 'COMM', 25, 'COUV', 5],
        journalTitle_s: ['Nature Communications', 12, 'PLoS ONE', 8],
        journalPublisher_s: ['Elsevier', 30, 'Springer', 0]
      }
    }
  };

  it('answers every facet asked under one query in one request', async () => {
    get.mockResolvedValue(resolved(200, FACETS));
    const asked = query({});

    const { facets: counted, failures } = await facets({
      requests: (['year', 'stage', 'venue', 'publisher'] as const).map(facet => ({ facet, query: asked })),
      years: [2024, 2023],
      openAccessOnly: true,
      timeoutMs: 1000
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
    expect(counted).toEqual({
      year: [{ value: 2024, count: 50 }, { value: 2023, count: 40 }],
      // The published types add up: a record has one type.
      stage: [{ value: 'published', count: 100 }, { value: 'preprint', count: 20 }],
      venue: [{ value: 'Nature Communications', count: 12 }, { value: 'PLoS ONE', count: 8 }],
      publisher: [{ value: 'Elsevier', count: 30 }]
    });
  });

  it('asks again only for a facet counted under a query of its own', async () => {
    get.mockResolvedValue(resolved(200, FACETS));

    await facets({
      requests: [
        { facet: 'venue', query: query({ years: { from: 2024, to: 2024 } }) },
        { facet: 'year', query: query({}) }
      ],
      years: [],
      openAccessOnly: true,
      timeoutMs: 1000
    });

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reports a failed count rather than throwing', async () => {
    get.mockResolvedValue(resolved(503, ''));

    const { facets: counted, failures } = await facets({
      requests: [{ facet: 'year', query: query({}) }],
      years: [],
      openAccessOnly: true,
      timeoutMs: 1000
    });

    expect(counted).toEqual({});
    expect(failures).toEqual(['HAL returned no search response: HTTP 503']);
  });

  it('asks nothing for a query with nothing to search for', async () => {
    const { facets: counted } = await facets({
      requests: [{ facet: 'year', query: query({ terms: [] }) }],
      years: [],
      openAccessOnly: true,
      timeoutMs: 1000
    });

    expect(get).not.toHaveBeenCalled();
    expect(counted).toEqual({});
  });
});
