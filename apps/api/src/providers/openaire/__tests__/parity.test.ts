import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord } from '@open-access-explorer/shared';
import { normalize } from '../normalize';
import { OpenAIREConnector } from '../../../sources/openaire';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../sources/__fixtures__/openaire.json');
const AT = '2026-08-29T00:00:00.000Z';

const rawResults = (() => {
  const r = RECORDED.response.results.result;
  return Array.isArray(r) ? r : [r];
})();

const oldConnector = new OpenAIREConnector() as any;
const oldRecords: OARecord[] = rawResults.map((r: any) => oldConnector.normalizeResult(r));
const newRecords: OARecord[] = normalize(RECORDED, { retrievedAt: AT }).papers.map(toOARecord);

/**
 * Almost nothing is strictly comparable here, and that is the finding rather
 * than a gap in the test: the old connector read the xml2js spelling of a JSON
 * payload, so `id`, `doi`, `venue`, `language` and `topics` were all either
 * wrong or empty. Each is asserted below as a correction.
 */
const COMPARABLE = ['title', 'authors', 'year', 'source', 'publisher', 'abstract'] as const;

const populated = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

describe('parity with the old OpenAIRE connector', () => {
  it('produces the same number of records', () => {
    expect(newRecords).toHaveLength(oldRecords.length);
  });

  it.each(COMPARABLE)('agrees on %s wherever the old connector populated it', field => {
    oldRecords.forEach((before, i) => {
      if (!populated(before[field])) return;
      expect(newRecords[i][field], `${field} on ${before.id}`).toEqual(before[field]);
    });
  });
});

describe('corrections, each one a field the old connector read from the wrong key', () => {
  it('gives the record OpenAIRE\'s identifier instead of a slug of its title', () => {
    expect(oldRecords[0].sourceId).toBe('The-potential-and-innovative-applications-of-CRISP');
    expect(newRecords[0].sourceId).toBe('doi_dedup___::469542ac104a1a2aa4c8c8a76e46bf9c');
  });

  it('supplies the DOI, without which no OpenAIRE record could deduplicate', () => {
    expect(oldRecords.every(r => r.doi === undefined)).toBe(true);
    expect(newRecords[0].doi).toBe('10.1016/j.enzmictec.2025.110799');
  });

  it('puts the journal in venue and leaves the publisher in publisher', () => {
    expect(oldRecords[0].venue).toBe(oldRecords[0].publisher);
    expect(newRecords[0].venue).toBe('Enzyme and Microbial Technology');
    expect(newRecords[0].publisher).toBe('Elsevier BV');
  });

  it('reads the real language code', () => {
    expect(oldRecords[0].language).toBe('en');
    expect(newRecords[0].language).toBe('eng');
  });

  it('supplies topics, which the old connector hardcoded to empty', () => {
    expect(oldRecords.every(r => (r.topics ?? []).length === 0)).toBe(true);
    expect(newRecords[0].topics?.length).toBeGreaterThan(0);
  });
});

describe('documented differences', () => {
  it('survives a record the old normaliser threw on', () => {
    // The old one threw on a missing `oaf:result`, and `results.map` did not
    // catch it, so one malformed record discarded the whole page.
    const malformed = { header: { 'dri:objIdentifier': { $: 'x' } }, metadata: {} };
    expect(() => oldConnector.normalizeResult(malformed)).toThrow();

    const outcome = normalize(
      { response: { header: { total: { $: 1 } }, results: { result: [malformed] } } } as any,
      { retrievedAt: AT }
    );
    expect(outcome.papers).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('separates when a paper was accepted from when we retrieved it', () => {
    expect(newRecords[0].createdAt).toBe(AT);
    expect(newRecords[0].year).toBe(2026);
  });
});
