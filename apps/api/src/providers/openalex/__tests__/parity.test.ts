import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { EnhancedSearchPipeline } from '../../../lib/enhanced-search-pipeline';

/**
 * The new provider against the conversion it replaces.
 *
 * OpenAlex had no connector — the old path turned a work into a record inline,
 * in `enrichWorks`, which also applies two hard filters of its own: a work that
 * is not open access, or that has no `oa_url`, never became a record at all.
 * Every record in the recorded page passes both, so the comparison is over the
 * same three works.
 */

const RECORDED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../__fixtures__/recorded.json'), 'utf8')
);
const AT = '2026-08-30T00:00:00.000Z';

const pipeline = new EnhancedSearchPipeline({ userAgent: 'test/1.0 (mailto:test@example.com)' });

let oldRecords: OARecord[];
let newRecords: OARecord[];

beforeAll(async () => {
  oldRecords = await (pipeline as any).enrichWorks(RECORDED.results, []);
  newRecords = normalize(RECORDED, { retrievedAt: AT }).papers.map(toOARecord);
});

/**
 * `id`, `sourceId`, `doi`, `landingPage`, `topics`, `oaStatus` and
 * `bestPdfUrl` are absent deliberately — every one is a documented correction
 * below.
 */
const COMPARABLE = ['title', 'authors', 'year', 'venue', 'abstract', 'source', 'language', 'citationCount'] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old inline conversion', () => {
  it('produces a record for every work the old path kept', () => {
    expect(newRecords).toHaveLength(oldRecords.length);
    expect(oldRecords).toHaveLength(RECORDED.results.length);
  });

  it.each(COMPARABLE)('agrees on %s wherever the old path populated it', field => {
    oldRecords.forEach((before, i) => {
      if (!populated(before[field])) return;
      expect(newRecords[i][field], `${field} on ${before.id}`).toEqual(before[field]);
    });
  });

  it('never leaves a field empty that the old path filled', () => {
    oldRecords.forEach((before, i) => {
      const lost = COMPARABLE.filter(f => populated(before[f]) && !populated(newRecords[i][f]));
      expect(lost, `fields lost on ${before.id}`).toEqual([]);
    });
  });
});

describe('corrections', () => {
  it('supplies the publisher, which the old path could never have read', () => {
    // It read `host_venue.publisher`; `host_venue` is not a valid select field
    // and `source.publisher` is not a field at all.
    expect(oldRecords.every(r => r.publisher === undefined)).toBe(true);
    expect(newRecords.every(r => populated(r.publisher))).toBe(true);
  });

  it('reports the access route instead of stamping every record "published"', () => {
    expect(oldRecords.every(r => r.oaStatus === 'published')).toBe(true);
    // `stage` still round-trips to the legacy field; the route lives on `Paper`.
    const routes = normalize(RECORDED, { retrievedAt: AT }).papers.map(p => p.oaStatus);
    expect(routes).toEqual(['green', 'bronze', 'bronze']);
  });

  it('gives the record a bare identifier rather than an embedded URL', () => {
    expect(oldRecords[0].id).toBe('openalex:https://openalex.org/W3015140168');
    expect(newRecords[0].id).toBe('openalex:W3015140168');
  });

  it('sends the reader to the DOI rather than to the OpenAlex record', () => {
    expect(oldRecords[0].landingPage).toBe('https://openalex.org/W3015140168');
    expect(newRecords[0].landingPage).toBe('https://doi.org/10.1038/s41565-020-0669-6');
  });

  it('stops calling a non-PDF oa_url a PDF', () => {
    // The first record's `oa_url` is a PMC article page.
    expect(oldRecords[0].bestPdfUrl).toBe(RECORDED.results[0].open_access.oa_url);
    const paper = normalize(RECORDED, { retrievedAt: AT }).papers[0];
    expect(paper.fullText?.kind).toBe('html');
  });

  it('stores a bare DOI rather than a URL', () => {
    // Every other migrated provider stores `10.x/y`. `normalizeDoi` strips the
    // prefix before comparing, so this changes no identity — it makes the
    // stored value mean the same thing everywhere.
    expect(oldRecords[0].doi).toBe('https://doi.org/10.1038/s41565-020-0669-6');
    expect(newRecords[0].doi).toBe('10.1038/s41565-020-0669-6');
  });

  it('uses topics rather than the concepts they supersede', () => {
    // 11 broad concepts against 3 precise topics on the same record. Folding
    // `keywords` in as well would put the count back to 14 and give up what
    // the change was for.
    expect(newRecords[0].topics).toEqual(RECORDED.results[0].topics.map((t: any) => t.display_name));
    expect((newRecords[0].topics ?? []).length).toBeLessThan(oldRecords[0].topics!.length);
  });

  it('separates when a paper was published from when we retrieved it', () => {
    // `created_date` was not in the select list, so `createdAt` fell back to
    // the current time on every record.
    expect(newRecords.every(r => r.createdAt === AT)).toBe(true);
  });
});
