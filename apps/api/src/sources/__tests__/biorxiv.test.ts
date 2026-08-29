import { describe, it, expect } from 'vitest';
import { BiorxivConnector } from '../biorxiv';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const items = readJson('biorxiv.json').collection;
const connector = new BiorxivConnector();
const normalize = normalizerOf(connector, 'normalizeResult');

describe('bioRxiv normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    items.map((i: any) => normalize(i, 'biorxiv')).forEach((r: any) => expectBaseRecord(r, 'biorxiv'));
  });

  it('labels records by the server that served them', () => {
    expect(normalize(items[0], 'biorxiv')!.source).toBe('biorxiv');
    expect(normalize(items[0], 'medrxiv')!.source).toBe('medrxiv');
    expect(normalize(items[0], 'biorxiv')!.venue).toBe('bioRxiv');
    expect(normalize(items[0], 'medrxiv')!.venue).toBe('medRxiv');
  });

  it('marks everything a preprint and builds a versioned PDF url', () => {
    const record = normalize(items[0], 'biorxiv')!;
    expect(record.oaStatus).toBe('preprint');
    expect(record.bestPdfUrl).toMatch(/^https:\/\/www\.biorxiv\.org\/content\/10\..+v\d+\.full\.pdf$/);
  });

  it('splits the semicolon-separated author string', () => {
    const record = normalize(items[0], 'biorxiv')!;
    expect(record.authors.length).toBeGreaterThan(0);
    record.authors.forEach(a => expect(a).not.toContain(';'));
  });
});
