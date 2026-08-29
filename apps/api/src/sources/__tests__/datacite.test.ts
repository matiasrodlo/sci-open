import { describe, it, expect } from 'vitest';
import { DataCiteConnector } from '../datacite';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const items = readJson('datacite.json').data;
const normalize = normalizerOf(new DataCiteConnector(), 'normalizeResult');

describe('DataCite normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    items.map((i: any) => normalize(i)).forEach((r: any) => expectBaseRecord(r, 'datacite'));
  });

  it('uses the DOI as the record identity', () => {
    const record = normalize(items[0])!;
    expect(record.doi).toMatch(/^10\./);
    expect(record.id).toBe(`datacite:${record.doi}`);
  });
});
