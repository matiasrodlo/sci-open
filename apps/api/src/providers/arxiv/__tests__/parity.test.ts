import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { ArxivConnector } from '../../../sources/arxiv';

/**
 * The new provider against the connector it will replace, on the same recorded
 * feed.
 *
 * The bar is "at least as good": every record the old one produced, and every
 * field it populated, with the same value. Anything the new one adds is
 * asserted separately, so a regression cannot hide behind an improvement.
 */

const read = (p: string) => parseStringPromise(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));

const AT = '2026-08-29T00:00:00.000Z';
const oldConnector = new ArxivConnector() as any;

let RECORDED: any;
let EDGE: any;
let oldRecords: OARecord[];
let newRecords: OARecord[];

beforeAll(async () => {
  RECORDED = await read('../../../__fixtures__/arxiv.xml');
  EDGE = await read('../__fixtures__/edge-cases.xml');
  oldRecords = RECORDED.feed.entry.map((e: any) => oldConnector.normalizeEntry(e));
  newRecords = normalize(RECORDED, { retrievedAt: AT }).papers.map(toOARecord);
});

/** Fields whose meaning is unchanged, so they must match exactly. */
const COMPARABLE = [
  'id', 'title', 'authors', 'year', 'abstract',
  'source', 'sourceId', 'oaStatus', 'bestPdfUrl', 'landingPage', 'topics', 'language'
] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old arXiv connector', () => {
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

describe('where the new provider is strictly better', () => {
  // The recorded feed carries neither field on any entry, which is why the
  // improvement is asserted against the hand-built one. Live, 3 of 16 entries
  // for `crispr gene editing` carried a DOI and 2 a journal reference; the old
  // connector read neither on any of them.
  const edgeOld = (): OARecord[] =>
    EDGE.feed.entry.filter((e: any) => e.title).map((e: any) => oldConnector.normalizeEntry(e));
  const edgeNew = (): OARecord[] => normalize(EDGE, { retrievedAt: AT }).papers.map(toOARecord);

  it('reads the DOI of the published version, which the old connector never did', () => {
    expect(edgeOld().every(r => r.doi === undefined)).toBe(true);
    expect(edgeNew().some(r => r.doi === '10.1038/s41467-022-30843-1')).toBe(true);
  });

  it('reads the venue, which the old connector never did', () => {
    expect(edgeOld().every(r => r.venue === undefined)).toBe(true);
    expect(edgeNew().some(r => populated(r.venue))).toBe(true);
  });

  it('survives an entry the old connector would have thrown on', () => {
    // `entry.title[0]` on an entry with no title. The old connector mapped the
    // whole feed in one expression, so this cost the page rather than the
    // record.
    const titleless = EDGE.feed.entry.find((e: any) => !e.title);
    expect(() => oldConnector.normalizeEntry(titleless)).toThrow();
    expect(edgeNew().length).toBe(EDGE.feed.entry.length - 1);
  });
});

describe('documented differences', () => {
  it('separates when a paper was submitted from when we retrieved it', () => {
    // The old connector wrote `published` into `createdAt`, falling back to
    // the current time — so the field meant "submitted" for some records and
    // "fetched" for others. The new provider always means "retrieved", and the
    // submission year lives in `year`.
    RECORDED.feed.entry.forEach((raw: any, i: number) => {
      expect(oldRecords[i].createdAt).toBe(raw.published[0]);
      expect(newRecords[i].createdAt).toBe(AT);
      expect(newRecords[i].year).toBe(new Date(raw.published[0]).getFullYear());
    });
  });
});
