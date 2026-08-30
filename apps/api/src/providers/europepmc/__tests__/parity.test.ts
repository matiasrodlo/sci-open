import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { EuropePMCConnector } from '../../../sources/europepmc';

/**
 * The new provider against the connector it will replace, on the same recorded
 * payload.
 *
 * The bar is "at least as good": every record the old one produced, and every
 * field it populated, with the same value. Anything the new one adds is an
 * improvement and is asserted separately, so a regression cannot hide behind
 * one.
 */

const RECORDED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../__fixtures__/europepmc.json'), 'utf8')
);
const RAW = RECORDED.resultList.result as any[];

const oldConnector = new EuropePMCConnector() as any;
const oldRecords: OARecord[] = RAW.map(r => oldConnector.normalizeResult(r));
const newRecords: OARecord[] = normalize(RECORDED as any, {
  retrievedAt: '2026-08-29T00:00:00.000Z'
}).papers.map(toOARecord);

/** Fields whose meaning is unchanged, so they must match exactly. */
const COMPARABLE = [
  'id', 'doi', 'title', 'authors', 'year', 'abstract',
  'source', 'sourceId', 'oaStatus', 'bestPdfUrl', 'landingPage', 'language'
] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old Europe PMC connector', () => {
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
  it('fills in venue, which the old connector never populated', () => {
    expect(oldRecords.every(r => r.venue === undefined)).toBe(true);
    expect(newRecords.every(r => populated(r.venue))).toBe(true);
  });

  it('fills in citationCount, which the old connector never populated', () => {
    expect(oldRecords.every(r => r.citationCount === undefined)).toBe(true);
    expect(newRecords.every(r => typeof r.citationCount === 'number')).toBe(true);
  });
});

describe('documented differences', () => {
  it('separates when a paper was published from when we retrieved it', () => {
    // The old connector wrote `firstPublicationDate` into `createdAt`, falling
    // back to the current time — so the field meant "published" for some
    // records and "fetched" for others. The new provider always means
    // "retrieved", and the publication year lives in `year`.
    RAW.forEach((raw, i) => {
      expect(oldRecords[i].createdAt).toBe(raw.firstPublicationDate);
      expect(newRecords[i].createdAt).toBe('2026-08-29T00:00:00.000Z');
      expect(newRecords[i].year).toBe(Number.parseInt(raw.pubYear, 10));
    });
  });
});
