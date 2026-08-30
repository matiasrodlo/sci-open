import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize } from '../normalize';

const RECORDED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../__fixtures__/europepmc.json'), 'utf8')
);
const EDGE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../__fixtures__/edge-cases.json'), 'utf8')
);

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });

describe('normalize — the recorded fixture', () => {
  const { papers, skipped } = run(RECORDED);

  it('reads every record', () => {
    expect(papers).toHaveLength(RECORDED.resultList.result.length);
    expect(skipped).toEqual([]);
  });

  it('supplies the venue the old connector dropped', () => {
    // The old connector read `journalTitle`, which Europe PMC does not return.
    // Measured on a live 1,500-record set: 0 of 301 Europe PMC records carried
    // a venue, while every other provider except arXiv supplied one.
    expect(papers[0].venue).toBe('Cell discovery');
    expect(papers.every(p => p.venue)).toBe(true);
  });

  it('supplies the citation count the old connector dropped', () => {
    // `citedByCount` is on every core record. Only OpenAlex was contributing
    // to the citations sort because of this.
    papers.forEach(p => expect(typeof p.citationCount).toBe('number'));
  });

  it('carries the fields its capabilities claim', () => {
    const p = papers[0];
    expect(p.doi).toMatch(/^10\./);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.authors.length).toBeGreaterThan(0);
    expect(p.year).toBeGreaterThan(1900);
    expect(p.abstract).toBeTruthy();
    expect(p.language).toBeTruthy();
  });

  it('records provenance, including rank', () => {
    papers.forEach((p, i) => {
      expect(p.sources).toHaveLength(1);
      expect(p.sources[0]).toMatchObject({
        provider: 'europepmc',
        rank: i,
        retrievedAt: AT
      });
      expect(p.sources[0].nativeId).toBeTruthy();
      expect(p.id).toBe(`europepmc:${p.sources[0].nativeId}`);
    });
  });

  it('offsets rank for a paged read', () => {
    const paged = normalize(RECORDED as any, { retrievedAt: AT, rankOffset: 100 });
    expect(paged.papers.map(p => p.sources[0].rank)).toEqual([100, 101, 102]);
  });

  it('prefers a real pdf and never claims to have verified it', () => {
    expect(papers[0].fullText).toEqual({
      url: 'https://europepmc.org/articles/PMC13172344?pdf=render',
      kind: 'pdf',
      verified: false
    });
  });

  it('leaves the access route unknown, because Europe PMC does not report one', () => {
    // Retrievability is `fullText`; the route is Unpaywall's vocabulary and
    // arrives during enrichment.
    papers.forEach(p => expect(p.oaStatus).toBe('unknown'));
    papers.forEach(p => expect(p.stage).toBe('published'));
  });
});

describe('normalize — the defects this provider fixes', () => {
  it('reads a record whose fullTextUrl is a bare object', () => {
    // The guard was applied when picking the PDF and not reused for the
    // landing page, so this shape raised a TypeError.
    const { papers, skipped } = run(EDGE);
    const single = papers.find(p => p.sources[0].nativeId === 'SINGLE1');

    expect(skipped.map(s => s.nativeId)).not.toContain('SINGLE1');
    expect(single?.landingPage).toBe('https://europepmc.org/articles/PMC0000001');
  });

  it('costs exactly one record per bad record', () => {
    const { papers, skipped } = run(EDGE);
    const total = EDGE.resultList.result.length;

    expect(skipped).toHaveLength(2);          // no title, no id
    expect(papers).toHaveLength(total - 2);
    expect(papers.length).toBeGreaterThan(0); // the page survives
  });

  it('says why a record was skipped, and where it was', () => {
    const { skipped } = run(EDGE);
    expect(skipped).toEqual([
      { index: 1, nativeId: 'NOTITLE1', reason: 'record has no title' },
      { index: 2, reason: 'record has no id' }
    ]);
  });

  it('does not lose the whole page when the first record is unreadable', () => {
    const payload = { resultList: { result: [{ source: 'MED' }, ...RECORDED.resultList.result] } };
    const { papers, skipped } = run(payload);
    expect(skipped).toHaveLength(1);
    expect(papers).toHaveLength(RECORDED.resultList.result.length);
  });
});

describe('normalize — shapes the recorded fixture does not contain', () => {
  const { papers } = run(EDGE);
  const find = (id: string) => papers.find(p => p.sources[0].nativeId === id);

  it('marks a PPR-sourced record as a preprint', () => {
    expect(find('PPR12345')?.stage).toBe('preprint');
  });

  it('falls back to authorString when there is no structured author list', () => {
    expect(find('PPR12345')?.authors).toEqual(['Lovelace A', 'Babbage C']);
  });

  it('falls back to a doi.org landing page when no html url is offered', () => {
    expect(find('PPR12345')?.landingPage).toBe('https://doi.org/10.1101/2021.01.01.000001');
  });

  it('reads a record carrying almost nothing', () => {
    const bare = find('BARE1');
    expect(bare).toBeDefined();
    expect(bare!.title).toBe('A bare but readable record');
    expect(bare!.authors).toEqual([]);
    expect(bare!.topics).toEqual([]);
    expect(bare!.fullText).toBeUndefined();
    expect(bare!.venue).toBeUndefined();
  });

  it('returns nothing, and no errors, for an empty payload', () => {
    expect(run({})).toEqual({ papers: [], skipped: [] });
    expect(run({ resultList: { result: [] } })).toEqual({ papers: [], skipped: [] });
  });
});
