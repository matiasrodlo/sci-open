import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { PLOSConnector } from '../../../sources/plos';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../__fixtures__/plos.json');
const AT = '2026-08-29T00:00:00.000Z';

const oldConnector = new PLOSConnector() as any;
const oldRecords: OARecord[] = RECORDED.response.docs.map((d: any) => oldConnector.normalizeResult(d));
const newRecords: OARecord[] = normalize(RECORDED, { retrievedAt: AT }).papers.map(toOARecord);

/** `topics` and `abstract` are absent deliberately — both are documented differences below. */
const COMPARABLE = [
  'id', 'doi', 'title', 'authors', 'year', 'venue',
  'source', 'sourceId', 'oaStatus', 'bestPdfUrl', 'landingPage', 'language'
] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old PLOS connector', () => {
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
      const lost = COMPARABLE.filter(f => populated(before[f]) && !populated(newRecords[i][f]));
      expect(lost, `fields lost on ${before.id}`).toEqual([]);
    });
  });
});

describe('documented differences', () => {
  it('stops reporting the article type as a topic', () => {
    // Every old record carried exactly one topic, "Research Article" — the
    // same value on every record in the corpus. The recorded page predates
    // asking PLOS for `subject`, so it has none to put there instead; live,
    // the field is requested and populated.
    expect(oldRecords.every(r => r.topics?.length === 1)).toBe(true);
    expect(oldRecords.every(r => r.topics?.[0] === 'Research Article')).toBe(true);
    expect(newRecords.every(r => (r.topics ?? []).length === 0)).toBe(true);
  });

  it('trims the whitespace PLOS wraps an abstract in', () => {
    // Solr returns the abstract with the source document's leading newline and
    // indentation still on it. The old connector passed that through, so every
    // PLOS abstract began with a line break.
    // Not every record is wrapped, so the assertion is the relationship —
    // plus at least one record that actually exercises it.
    oldRecords.forEach((before, i) => {
      if (!before.abstract) return;
      expect(newRecords[i].abstract).toBe(before.abstract.trim());
    });
    expect(oldRecords.some(r => r.abstract && /^\s/.test(r.abstract))).toBe(true);
  });

  it('adds the publisher, which the old connector never set', () => {
    expect(oldRecords.every(r => r.publisher === undefined)).toBe(true);
    expect(newRecords.every(r => r.publisher === 'Public Library of Science')).toBe(true);
  });

  it('separates when a paper was published from when we retrieved it', () => {
    RECORDED.response.docs.forEach((doc: any, i: number) => {
      expect(oldRecords[i].createdAt).toBe(doc.publication_date);
      expect(newRecords[i].createdAt).toBe(AT);
    });
  });
});
