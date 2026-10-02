import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// The pooled client resolves every status below 500 rather than throwing, so
// the status is read from the response. Every response below is resolved, as
// the real factory delivers them.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { fetchPage, PlosUnavailableError } from '../fetch';

const options = { pageSize: 10, offset: 0, timeoutMs: 1000 };
const resolved = (status: number, data: unknown) => ({ status, statusText: '', data });

// Braces deliberately: `mockReset()` returns the mock, and an arrow with an
// expression body hands that back to Vitest, which calls it as a teardown.
beforeEach(() => {
  get.mockReset();
});

describe('fetchPage', () => {
  it('returns a page that carries its docs', async () => {
    const page = { response: { numFound: 1, start: 0, docs: [{ id: '10.1371/journal.pone.0000001' }] } };
    get.mockResolvedValue(resolved(200, page));

    expect(await fetchPage('title:crispr', options)).toEqual(page);
  });

  /**
   * Measured on the compose stack on 2026-09-29: `TS=[crispr]` and `crispr{}`
   * reach PLOS's Solr unescaped and are answered HTTP 400. The status is what
   * lets the fan-out record that as the query being refused — asking again gets
   * the same 400 — rather than as PLOS failing to answer.
   */
  it('carries the status of a refusal, so the fan-out can tell it from a failure', async () => {
    get.mockResolvedValue(resolved(400, { error: { msg: "org.apache.solr.search.SyntaxError: Cannot parse 'title:[crispr]'" } }));

    const error = await fetchPage('title:[crispr]', options).catch(e => e);
    expect(error).toBeInstanceOf(PlosUnavailableError);
    expect(error).toMatchObject({ status: 400, message: 'PLOS returned no search response: HTTP 400' });
  });

  it('carries no status for a 200 that is not a result page, which is not a refusal', async () => {
    get.mockResolvedValue(resolved(200, { unexpected: true }));

    const error = await fetchPage('title:crispr', options).catch(e => e);
    expect(error).toBeInstanceOf(PlosUnavailableError);
    expect(error.status).toBeUndefined();
  });
});
