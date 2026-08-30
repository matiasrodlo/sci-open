import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { canServe } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { capabilities } from '../capabilities';
import { translate } from '../index';

const RECORDED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../__fixtures__/biorxiv.json'), 'utf8')
);

const AT = '2026-08-29T00:00:00.000Z';
const run = (collections: any[]) => normalize(collections, { retrievedAt: AT });
const recorded = () => run([{ server: 'biorxiv', collection: RECORDED.collection }]);

describe('capabilities — why there is no keyword search', () => {
  it('declines keyword search, so the orchestrator skips it', () => {
    // The API has no keyword index: a search was a scan of a 30-day window,
    // 30 records per request, grepped in process. The recorded window reports
    // 5,940 records and the scan was capped at 5 pages per server — 150 of
    // 5,940, across two servers, for ten HTTP requests, and blind to anything
    // older than 30 days.
    expect(RECORDED.messages[0].total).toBe('5940');
    expect(capabilities.keywordSearch).toBe(false);
    expect(canServe(capabilities, {})).toBe(false);
  });

  it('answers a DOI lookup, which is what the API is for', () => {
    expect(canServe(capabilities, { doi: '10.1101/2025.10.27.684732' })).toBe(true);
  });

  it('reports no total, having no corpus-wide count to give', () => {
    expect(capabilities.reportsTotal).toBe(false);
  });
});

describe('translate', () => {
  it('is the DOI, there being no query language', () => {
    expect(translate({ terms: [], phrases: [], join: 'AND', doi: '10.1101/x' })).toBe('10.1101/x');
  });

  it('is empty for a keyword query, which never reaches here', () => {
    expect(translate({ terms: ['crispr'], phrases: [], join: 'AND' })).toBe('');
  });
});

describe('normalize', () => {
  it('reads every record in the recorded window page', () => {
    const { papers, skipped } = recorded();
    expect(papers).toHaveLength(RECORDED.collection.length);
    expect(skipped).toEqual([]);
  });

  it('treats the string "NA" as absent', () => {
    // The API writes "NA" where a value is missing, so a truthiness check
    // reads it as present. The old connector's
    // `updatedAt: result.published || result.date` set `updatedAt` to the
    // literal "NA" on every unpublished preprint — all of them here.
    expect(RECORDED.collection.every((r: any) => r.published === 'NA')).toBe(true);
    expect(recorded().papers.every(p => p.updatedAt === undefined)).toBe(true);
  });

  it('records a preprint server as a green route', () => {
    const { papers } = recorded();
    expect(papers.every(p => p.oaStatus === 'green')).toBe(true);
    expect(papers.every(p => p.stage === 'preprint')).toBe(true);
  });

  it('builds the PDF and landing page off the version', () => {
    const [first] = recorded().papers;
    expect(first.fullText).toEqual({
      url: 'https://www.biorxiv.org/content/10.1101/2025.10.27.684732v3.full.pdf',
      kind: 'pdf',
      verified: false
    });
    expect(first.landingPage).toBe('https://www.biorxiv.org/content/10.1101/2025.10.27.684732v3');
  });

  it('splits the semicolon-separated author string', () => {
    expect(recorded().papers[0].authors.slice(0, 2)).toEqual(['Wang, Z.', 'Gong, X.']);
  });

  it('reads the category as a topic', () => {
    expect(recorded().papers[0].topics).toEqual(['neuroscience']);
  });

  it('attributes a record to the server it came from', () => {
    const outcome = run([
      { server: 'biorxiv', collection: [RECORDED.collection[0]] },
      { server: 'medrxiv', collection: [RECORDED.collection[1]] }
    ]);
    expect(outcome.papers.map(p => p.sources[0].provider)).toEqual(['biorxiv', 'medrxiv']);
    expect(outcome.papers[1].venue).toBe('medRxiv');
    expect(outcome.papers[1].id.startsWith('medrxiv:')).toBe(true);
  });

  it('costs exactly one record when a record cannot be read', () => {
    const outcome = run([
      { server: 'biorxiv', collection: [{ doi: '10.1101/x' }, RECORDED.collection[0]] }
    ]);
    expect(outcome.papers).toHaveLength(1);
    expect(outcome.skipped).toEqual([
      { index: 0, nativeId: '10.1101/x', reason: 'record has no title' }
    ]);
  });

  it('defaults to version 1 when none is given', () => {
    const outcome = run([
      { server: 'biorxiv', collection: [{ doi: '10.1101/x', title: 'A record', date: '2024-01-01' }] }
    ]);
    expect(outcome.papers[0].landingPage).toBe('https://www.biorxiv.org/content/10.1101/xv1');
  });
});

describe('fetchByDoi — the URL it builds', () => {
  it('keeps the slash in the DOI, which the API needs in its path', async () => {
    // `encodeURIComponent` would turn `10.1101/2025.10.27.684732` into
    // `10.1101%2F2025…`, which the API answers with 404. One of the two
    // servers 404s on every lookup by design, so that failure reads as "not
    // found" rather than as a malformed request — verified live: the raw
    // slash returns 3 records, the escaped one returns 404.
    const { fetchByDoi } = await import('../fetch');
    const seen: string[] = [];
    const axios = (await import('axios')).default;
    const spy = vi.spyOn(axios, 'get').mockImplementation(async (url: any) => {
      seen.push(String(url));
      return { data: { collection: [] } } as any;
    });

    await fetchByDoi('10.1101/2025.10.27.684732', { timeoutMs: 1000 });
    spy.mockRestore();

    expect(seen[0]).toContain('/details/biorxiv/10.1101/2025.10.27.684732');
    expect(seen.every(u => !u.includes('%2F'))).toBe(true);
  });
});

describe('normalize — versions of one preprint', () => {
  it('returns one record per DOI, at its highest version', () => {
    // A details lookup returns every version — three for this record — and
    // they are one work. Merge would collapse them by DOI, but a provider that
    // reports a work three times has already misreported what it retrieved.
    const versions = [
      { doi: '10.1101/x', title: 'A preprint', date: '2024-01-01', version: '1' },
      { doi: '10.1101/x', title: 'A preprint', date: '2024-02-01', version: '3' },
      { doi: '10.1101/x', title: 'A preprint', date: '2024-01-15', version: '2' }
    ];
    const { papers } = run([{ server: 'biorxiv', collection: versions }]);

    expect(papers).toHaveLength(1);
    expect(papers[0].landingPage).toBe('https://www.biorxiv.org/content/10.1101/xv3');
  });

  it('still reports an unreadable record rather than dropping it in the dedup', () => {
    const { papers, skipped } = run([
      { server: 'biorxiv', collection: [{ title: 'No doi here' }, { doi: '10.1101/y', title: 'Fine', date: '2024-01-01' }] }
    ]);
    expect(papers).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('record has no doi');
  });
});
