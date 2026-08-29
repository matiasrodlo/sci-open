import { describe, it, expect, beforeAll } from 'vitest';
import { ArxivConnector } from '../arxiv';
import { readXml, normalizerOf, expectBaseRecord } from './fixtures';

const normalize = normalizerOf(new ArxivConnector(), 'normalizeEntry');
let entries: any[];

beforeAll(async () => {
  entries = (await readXml('arxiv.xml')).feed.entry;
});

describe('arXiv normaliser', () => {
  it('maps every entry in the fixture without throwing', () => {
    entries.map(e => normalize(e)).forEach(r => expectBaseRecord(r, 'arxiv'));
  });

  it('marks everything a preprint and links the versioned PDF', () => {
    const record = normalize(entries[0])!;
    expect(record.oaStatus).toBe('preprint');
    expect(record.bestPdfUrl).toMatch(/^https:\/\/arxiv\.org\/pdf\//);
  });

  it('keeps the arXiv id, including its version suffix', () => {
    const record = normalize(entries[0])!;
    expect(record.sourceId).toMatch(/^\d{4}\.\d{4,5}v\d+$/);
    expect(record.id).toBe(`arxiv:${record.sourceId}`);
  });
});
