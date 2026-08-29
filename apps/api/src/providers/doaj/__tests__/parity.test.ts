import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { DOAJConnector } from '../../../sources/doaj';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../sources/__fixtures__/doaj.json');
const AT = '2026-08-29T00:00:00.000Z';

const oldConnector = new DOAJConnector() as any;
const oldRecords: OARecord[] = RECORDED.results.map((a: any) => oldConnector.normalizeArticle(a));
const newRecords: OARecord[] = normalize(RECORDED, { retrievedAt: AT }).papers.map(toOARecord);

/**
 * `bestPdfUrl` and `topics` are absent deliberately — both are asserted below
 * as differences rather than as matches.
 */
const COMPARABLE = [
  'id', 'doi', 'title', 'authors', 'year', 'venue', 'publisher', 'abstract',
  'source', 'sourceId', 'oaStatus', 'landingPage'
] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old DOAJ connector', () => {
  it('produces at least as many records', () => {
    expect(newRecords.length).toBeGreaterThanOrEqual(oldRecords.length);
  });

  it('returns the same records, identified the same way', () => {
    expect(newRecords.map(r => r.id)).toEqual(oldRecords.map(r => r.id));
  });

  it.each(COMPARABLE)('agrees on %s wherever the old connector populated it', field => {
    oldRecords.forEach((before, i) => {
      if (!populated(before[field])) return;
      expect(newRecords[i][field], `${field} on ${before.id}`).toEqual(before[field]);
    });
  });

  it('never leaves a field empty that the old connector filled', () => {
    oldRecords.forEach((before, i) => {
      const after = newRecords[i];
      const lost = COMPARABLE.filter(f => populated(before[f]) && !populated(after[f]));
      expect(lost, `fields lost on ${before.id}`).toEqual([]);
    });
  });
});

describe('documented differences', () => {
  it('stops calling an HTML page a PDF', () => {
    // The old connector matched `type: 'fulltext'` as a PDF selector. Not one
    // of these links is a PDF — one is explicitly text/html — so every record
    // named a journal landing page as its PDF.
    const papers = normalize(RECORDED, { retrievedAt: AT }).papers;
    expect(papers.every(p => p.fullText?.kind === 'html')).toBe(true);
  });

  it('still flattens that link into bestPdfUrl, which is the adapter\'s doing', () => {
    // `toOARecord` maps `fullText.url` to `bestPdfUrl` whatever the kind, so
    // the old shape cannot express the distinction the new one just made. The
    // format is right in `Paper` and lost on the way out — the same cost the
    // adapter documents for `fieldSources` and `sources`, and it goes away
    // when the frontend moves onto `Paper` in phase 11.
    oldRecords.forEach((before, i) => {
      expect(newRecords[i].bestPdfUrl).toBe(before.bestPdfUrl);
    });
  });

  it('adds the journal subject terms to topics', () => {
    oldRecords.forEach((before, i) => {
      const after = newRecords[i].topics ?? [];
      expect(after).toEqual(expect.arrayContaining(before.topics ?? []));
      expect(after.length).toBeGreaterThanOrEqual((before.topics ?? []).length);
    });
  });

  it('separates when a paper was published from when we retrieved it', () => {
    RECORDED.results.forEach((raw: any, i: number) => {
      expect(oldRecords[i].createdAt).toBe(raw.created_date);
      expect(newRecords[i].createdAt).toBe(AT);
      expect(newRecords[i].year).toBe(Number.parseInt(raw.bibjson.year, 10));
    });
  });
});
