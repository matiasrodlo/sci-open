import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SourceSort } from '@sci-open/shared';

/**
 * What each provider is sent for each order a search can ask for. Every
 * spelling here was checked against the live API on 2026-10-06; an order a
 * provider does not list in `capabilities.sorts` is never sent, and it reads
 * by relevance instead.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../lib/http-client-factory', () => ({
  getPooledClient: () => ({ get, post })
}));

import * as europepmc from '../europepmc';
import * as ncbi from '../ncbi';
import * as arxiv from '../arxiv';
import * as plos from '../plos';
import * as openaire from '../openaire';
import * as doaj from '../doaj';

const BASE = { pageSize: 1, offset: 0, timeoutMs: 1000 };
const sentParams = () => get.mock.calls[0]![1].params as Record<string, unknown>;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('the orders each source is asked to read in', () => {
  it('Europe PMC: newest and most cited first, never oldest first', async () => {
    get.mockResolvedValue({ status: 200, data: { hitCount: 0 } });
    await europepmc.fetchPage('crispr', { ...BASE, sort: 'date' });
    expect(sentParams().sort).toBe('FIRST_PDATE_D desc');

    get.mockReset();
    get.mockResolvedValue({ status: 200, data: { hitCount: 0 } });
    await europepmc.fetchPage('crispr', { ...BASE, sort: 'citations' });
    expect(sentParams().sort).toBe('CITED desc');

    get.mockReset();
    get.mockResolvedValue({ status: 200, data: { hitCount: 0 } });
    await europepmc.fetchPage('crispr', { ...BASE, sort: 'date_asc' });
    expect(sentParams()).not.toHaveProperty('sort');
    expect(europepmc.capabilities.sorts).toEqual(['date', 'citations']);
  });

  it('PubMed: newest first is pub_date; anything else is relevance', async () => {
    const orders: Array<[SourceSort | undefined, string]> = [['date', 'pub_date'], ['citations', 'relevance'], [undefined, 'relevance']];
    for (const [sort, expected] of orders) {
      get.mockReset();
      get.mockResolvedValue({ status: 200, data: { esearchresult: { count: '0', idlist: [] } } });
      await ncbi.fetchPage('crispr', { ...BASE, ...(sort ? { sort } : {}) });
      expect(sentParams().sort).toBe(expected);
    }
    expect(ncbi.capabilities.sorts).toEqual(['date']);
  });

  it('arXiv: by submission date, either way', async () => {
    const feed = '<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>0</opensearch:totalResults></feed>';
    for (const [sort, by, order] of [['date', 'submittedDate', 'descending'], ['date_asc', 'submittedDate', 'ascending'], [undefined, 'relevance', 'descending']] as const) {
      get.mockReset();
      get.mockResolvedValue({ status: 200, data: feed });
      await arxiv.fetchPage('all:crispr', { ...BASE, ...(sort ? { sort } : {}) });
      expect(sentParams()).toMatchObject({ sortBy: by, sortOrder: order });
    }
  });

  it('PLOS: by publication date, either way', async () => {
    get.mockResolvedValue({ status: 200, data: { response: { numFound: 0, docs: [] } } });
    await plos.fetchPage('everything:crispr', { ...BASE, sort: 'date_asc' });
    expect(sentParams().sort).toBe('publication_date asc');
  });

  it('OpenAIRE: newest first ends at next year, which keeps out records dated 9999', async () => {
    const empty = { status: 200, data: { header: { numFound: 0 }, results: [] } };
    const now = () => new Date('2026-10-06T00:00:00Z');

    get.mockResolvedValue(empty);
    await openaire.fetchPage({ search: 'crispr', type: 'publication' }, { ...BASE, sort: 'date', now });
    expect(sentParams()).toMatchObject({ sortBy: 'publicationDate DESC', toPublicationDate: '2027-12-31' });

    // A read with an end of its own keeps it.
    get.mockReset();
    get.mockResolvedValue(empty);
    await openaire.fetchPage({ search: 'crispr', type: 'publication', toPublicationDate: '2020-12-31' }, { ...BASE, sort: 'date', now });
    expect(sentParams()).toMatchObject({ sortBy: 'publicationDate DESC', toPublicationDate: '2020-12-31' });

    get.mockReset();
    get.mockResolvedValue(empty);
    await openaire.fetchPage({ search: 'crispr', type: 'publication' }, { ...BASE, sort: 'citations', now });
    expect(sentParams()).toMatchObject({ sortBy: 'citationCount DESC' });
    expect(sentParams()).not.toHaveProperty('toPublicationDate');
  });

  it('DOAJ: no order but relevance', () => {
    expect(doaj.capabilities.sorts ?? []).toEqual([]);
  });
});
