import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Query } from '@open-access-explorer/shared';
import { canServe } from '@open-access-explorer/shared';
import { translate } from '../translate';
import { normalize, totalHits } from '../normalize';
import { capabilities } from '../capabilities';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../__fixtures__/datacite.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `datacite:${id}`)!;
const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('capabilities — the decision this provider exists to record', () => {
  it('declines keyword search, and the orchestrator therefore skips it', () => {
    // Measured on a live search: 87 records returned, 1 surviving the policy
    // filter, and 0 of its 87 DOIs appearing in any of the six other
    // providers' results. A provider that finds nothing readable can still
    // earn its request by adding provenance to works others found — DataCite
    // cannot, because its corpus of repository items and theses is disjoint
    // from theirs.
    expect(capabilities.keywordSearch).toBe(false);
    expect(canServe(capabilities, {})).toBe(false);
  });

  it('still answers a DOI lookup, which is what it is good for', () => {
    // A DataCite DOI resolves here and nowhere else in the fan-out, precisely
    // because the corpus is disjoint.
    expect(canServe(capabilities, { doi: '10.5281/zenodo.222' })).toBe(true);
  });
});

describe('translate', () => {
  it('searches the whole record rather than titles behind a leading wildcard', () => {
    // The old connector sent `titles.title:*crispr gene editing*` — the
    // expensive shape for Elasticsearch, and title-only: 2,412 hits against
    // 6,003 for the same words across the record.
    expect(translate(query({ terms: ['crispr', 'gene'] }))).toBe('(crispr AND gene)');
    expect(translate(query({ terms: ['crispr'] }))).not.toContain('*');
  });

  it('looks a DOI up by DOI', () => {
    expect(translate(query({ doi: '10.5281/zenodo.222' }))).toBe('doi:"10.5281/zenodo.222"');
  });

  it('accepts a wildcard range endpoint, which this API allows', () => {
    // arXiv answers 500 for this shape and DOAJ answers 400; DataCite does
    // not, so there is no reason to invent a bound.
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('x AND publicationYear:[2024 TO *]');
  });
});

describe('normalize — describing the records honestly', () => {
  it('skips a dataset, naming the type', () => {
    // 11 of 100 live records are datasets. They are legitimate DataCite
    // records and not what a literature search is looking for, so they are
    // reported as skips rather than returned for a filter that cannot
    // recognise them.
    const { papers, skipped } = run(EDGE);
    expect(papers.find(p => p.id === 'datacite:10.5281/zenodo.111')).toBeUndefined();
    expect(skipped).toContainEqual({
      index: 0,
      nativeId: '10.5281/zenodo.111',
      reason: 'not a paper: Dataset'
    });
  });

  it('offers a PDF only when there really is one', () => {
    expect(find('10.5281/zenodo.222').fullText).toEqual({
      url: 'https://zenodo.org/record/222/files/paper.pdf',
      kind: 'pdf',
      verified: false
    });
  });

  it('calls a repository handle a landing page and not a PDF', () => {
    const record = find('10.5281/zenodo.333');
    expect(record.fullText).toBeUndefined();
    expect(record.landingPage).toBe('https://repo.example.org/handle/1234');
  });

  it('reads the version from the resource type', () => {
    // Real information the old connector ignored: it derived a status from
    // whether an `IsPublishedIn` relation existed, which on 100 live records
    // was never.
    expect(find('10.5281/zenodo.222').stage).toBe('preprint');
    expect(find('10.5281/zenodo.333').stage).toBe('published');
    expect(find('10.5281/zenodo.444').stage).toBe('unknown');
  });

  it('leaves the access route unknown rather than inferring it from an absence', () => {
    expect(run(EDGE).papers.every(p => p.oaStatus === 'unknown')).toBe(true);
  });

  it('builds an author name from the parts when there is no full name', () => {
    expect(find('10.5281/zenodo.222').authors).toEqual(['Grace Hopper']);
  });

  it('reads the subjects as topics', () => {
    expect(find('10.5281/zenodo.222').topics).toEqual(['crispr', 'gene editing']);
  });

  it('invents no venue', () => {
    // The old connector fell back to the literal string 'DataCite Repository'.
    expect(run(EDGE).papers.every(p => p.venue === undefined)).toBe(true);
    expect(find('10.5281/zenodo.222').publisher).toBe('Zenodo');
  });

  it('skips an untitled record rather than calling it "Untitled"', () => {
    const { skipped } = run(EDGE);
    expect(skipped).toContainEqual({
      index: 4,
      nativeId: '10.5281/zenodo.555',
      reason: 'record has no title'
    });
  });
});

describe('normalize — the recorded fixture', () => {
  it('reads every record it recognises as a paper', () => {
    const { papers, skipped } = run(RECORDED);
    expect(papers.length + skipped.length).toBe(RECORDED.data.length);
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(2412);
  });

  it('gives no record a PDF, because none of them has one', () => {
    // 0 of 3 recorded records carry a PDF format, matching 1 of 100 live.
    expect(run(RECORDED).papers.every(p => p.fullText === undefined)).toBe(true);
  });
});

describe('fetchPage — an unconfigured key is not a key', () => {
  it('sends no Authorization header for a placeholder', async () => {
    // DataCite answers `Bearer your_datacite_api_key_here` with 401 where no
    // header answers 200, so passing the sample env file's value through
    // breaks the provider rather than degrading it to anonymous access. The
    // sweep caught this as `no data array (HTTP 401)`.
    const { fetchPage } = await import('../fetch');
    const factory = await import('../../../lib/http-client-factory');

    let headers: any;
    const spy = vi.spyOn(factory, 'getPooledClient').mockReturnValue({
      get: async (_url: string, config: any) => {
        headers = config.headers;
        return { status: 200, data: { data: [], meta: { total: 0 } } };
      }
    } as any);

    await fetchPage('crispr', {
      pageSize: 1, offset: 0, timeoutMs: 1000, apiKey: 'your_datacite_api_key_here'
    });
    spy.mockRestore();

    expect(headers.Authorization).toBeUndefined();
  });
});
