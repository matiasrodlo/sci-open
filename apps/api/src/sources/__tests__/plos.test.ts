import { describe, it, expect } from 'vitest';
import { PLOSConnector } from '../plos';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const docs = readJson('plos.json').response.docs;
const normalize = normalizerOf(new PLOSConnector(), 'normalizeResult');

describe('PLOS normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    docs.map((d: any) => normalize(d)).forEach((r: any) => expectBaseRecord(r, 'plos'));
  });

  it('stamps records as plos rather than core', () => {
    // PLOS records used to be labelled `core`, which made the source facet and
    // the paper-detail route disagree about who supplied them.
    expect(normalize(docs[0])!.source).toBe('plos');
  });

  it('carries a DOI, a venue and a year', () => {
    const record = normalize(docs[0])!;
    expect(record.doi).toMatch(/^10\.1371\//);
    expect(record.venue).toBeTruthy();
    expect(record.year).toBeGreaterThan(1900);
  });
});
