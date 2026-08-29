import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { NCBIConnector } from '../../../sources/ncbi';

/**
 * The new provider against the connector it will replace, on the same recorded
 * payload.
 *
 * The bar is "at least as good": every record the old one produced, and every
 * field it populated, with the same value. Anything the new one adds is
 * asserted separately, so a regression cannot hide behind an improvement.
 */

const read = (p: string) => parseStringPromise(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const AT = '2026-08-29T00:00:00.000Z';
const oldConnector = new NCBIConnector() as any;

let raw: any[];
let oldRecords: OARecord[];
let newRecords: OARecord[];

beforeAll(async () => {
  raw = (await read('../../../sources/__fixtures__/ncbi-efetch.xml')).PubmedArticleSet.PubmedArticle;
  oldRecords = raw.map(a => oldConnector.normalizeArticle(a)).filter(Boolean);
  newRecords = normalize(raw, { retrievedAt: AT }).papers.map(toOARecord);
});

/**
 * Fields whose meaning is unchanged, so they must match exactly.
 *
 * `authors` is absent deliberately — see the documented difference below.
 */
const COMPARABLE = [
  'id', 'title', 'year', 'venue', 'abstract',
  'source', 'sourceId', 'oaStatus', 'bestPdfUrl', 'landingPage', 'language'
] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old NCBI connector', () => {
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
  it('supplies the DOI, which the old connector never read', () => {
    expect(oldRecords.every(r => r.doi === undefined)).toBe(true);
    expect(newRecords.every(r => populated(r.doi))).toBe(true);
  });

  it('supplies topics, which the old connector hardcoded to empty', () => {
    expect(oldRecords.every(r => (r.topics ?? []).length === 0)).toBe(true);
    expect(newRecords.every(r => (r.topics ?? []).length > 0)).toBe(true);
  });

  it('names a collective author the old connector rendered as blank', () => {
    // `<Author><CollectiveName>Frontiers Production Office</CollectiveName></Author>`
    // has no LastName, ForeName or Initials, so the old connector built its
    // name out of three empty strings.
    const before = oldRecords.find(r => r.id === 'ncbi:42657352')!;
    const after = newRecords.find(r => r.id === 'ncbi:42657352')!;
    expect(before.authors).toEqual(['']);
    expect(after.authors).toEqual(['Frontiers Production Office']);
  });
});

describe('documented differences', () => {
  it('agrees on every author the old connector managed to name', () => {
    oldRecords.forEach((before, i) => {
      const named = before.authors.filter(a => a.trim());
      if (named.length === 0) return;
      expect(newRecords[i].authors).toEqual(before.authors);
    });
  });

  it('separates when a paper was published from when we retrieved it', () => {
    // The old connector stamped `createdAt` with the current time on every
    // record, so it never carried a publication date at all — the field simply
    // meant "when this ran". The new provider always means "retrieved", and
    // the publication year lives in `year`.
    newRecords.forEach(record => {
      expect(record.createdAt).toBe(AT);
      expect(typeof record.year).toBe('number');
    });
  });
});
