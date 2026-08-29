import { describe, it, expect } from 'vitest';
import { DOAJConnector } from '../doaj';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const articles = readJson('doaj.json').results;
const normalize = normalizerOf(new DOAJConnector(), 'normalizeArticle');

describe('DOAJ normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    articles.map((a: any) => normalize(a)).forEach((r: any) => expectBaseRecord(r, 'doaj'));
  });

  it('carries DOI, venue, year and abstract', () => {
    const record = normalize(articles[0])!;
    expect(record.doi).toMatch(/^10\./);
    expect(record.venue).toBeTruthy();
    expect(record.year).toBeGreaterThan(1900);
    expect(record.abstract).toBeTruthy();
  });

  it('treats DOAJ content as open access', () => {
    // Everything in the directory is OA by definition, so a record that
    // normalises to anything else would be dropped by the policy filter.
    expect(normalize(articles[0])!.oaStatus).toBe('published');
  });
});
