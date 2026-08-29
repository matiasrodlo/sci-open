import { describe, it, expect } from 'vitest';
import { EuropePMCConnector } from '../europepmc';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const payload = readJson('europepmc.json');
const normalize = normalizerOf(new EuropePMCConnector(), 'normalizeResult');

describe('Europe PMC normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    const records = payload.resultList.result.map((r: any) => normalize(r));
    expect(records).toHaveLength(payload.resultList.result.length);
    records.forEach((r: any) => expectBaseRecord(r, 'europepmc'));
  });

  it('supplies the fields the provenance matrix credits it with', () => {
    const record = normalize(payload.resultList.result[0])!;
    expect(record.doi).toMatch(/^10\./);
    expect(record.year).toBeGreaterThan(1900);
    expect(record.abstract).toBeTruthy();
    expect(record.authors.length).toBeGreaterThan(0);
  });

  it('keys the id on the provider id, so records stay addressable', () => {
    const record = normalize(payload.resultList.result[0])!;
    expect(record.id).toBe(`europepmc:${record.sourceId}`);
  });
});
