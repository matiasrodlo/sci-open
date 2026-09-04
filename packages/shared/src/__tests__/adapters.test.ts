import { describe, it, expect } from 'vitest';
import type { OARecord, Paper, PaperStage } from '../index';
import { toOARecord } from '../index';

/**
 * `toOARecord` is the response shape in one function: every search hit and
 * every paper lookup leaves the service through it. What these assert is that
 * it reports what the `Paper` carried and nothing else — no invented keys, no
 * dropped optional field, and the provider attribution taken from the record
 * the merge was built on.
 *
 * The round-trip suite that used to sit here went with `fromOARecord`. It
 * asserted `toOARecord(fromOARecord(x))` returned `x` unchanged, which was the
 * property the phase-07 flag rested on while two paths ran side by side. With
 * one path there is no second shape for a record to enter in, so what is left
 * to pin is the one direction that runs.
 */

function paper(over: Partial<Paper> = {}): Paper {
  return {
    id: 'europepmc:42',
    doi: '10.1234/example',
    title: 'A study of things',
    authors: ['Lovelace, Ada', 'Babbage, Charles'],
    year: 2020,
    venue: 'Journal of Things',
    publisher: 'Thing Press',
    abstract: 'We studied things and report what we found.',
    topics: ['genomics', 'crispr'],
    language: 'en',
    citationCount: 17,
    oaStatus: 'green',
    stage: 'published',
    fullText: { url: 'https://example.org/paper.pdf', kind: 'pdf', verified: false },
    landingPage: 'https://doi.org/10.1234/example',
    sources: [
      {
        provider: 'europepmc',
        nativeId: '42',
        rank: 0,
        retrievedAt: '2024-01-01T00:00:00.000Z',
        latency: 421
      }
    ],
    fieldSources: {},
    retrievedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-02-01T00:00:00.000Z',
    ...over
  };
}

/** Everything `Paper` requires and nothing it does not. */
function bare(over: Partial<Paper> = {}): Paper {
  return {
    id: 'arxiv:2301.00001',
    title: 'Bare',
    authors: [],
    topics: [],
    oaStatus: 'unknown',
    stage: 'unknown',
    sources: [
      { provider: 'arxiv', nativeId: '2301.00001', rank: 0, retrievedAt: '2024-01-01T00:00:00.000Z' }
    ],
    fieldSources: {},
    retrievedAt: '2024-01-01T00:00:00.000Z',
    ...over
  };
}

describe('toOARecord', () => {
  it('flattens a fully populated paper', () => {
    const expected: OARecord = {
      id: 'europepmc:42',
      doi: '10.1234/example',
      title: 'A study of things',
      authors: ['Lovelace, Ada', 'Babbage, Charles'],
      year: 2020,
      venue: 'Journal of Things',
      publisher: 'Thing Press',
      abstract: 'We studied things and report what we found.',
      source: 'europepmc',
      sourceId: '42',
      oaStatus: 'published',
      bestPdfUrl: 'https://example.org/paper.pdf',
      landingPage: 'https://doi.org/10.1234/example',
      topics: ['genomics', 'crispr'],
      language: 'en',
      citationCount: 17,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z'
    };

    expect(toOARecord(paper())).toEqual(expected);
  });

  it('does not invent keys for what the paper did not carry', () => {
    expect(Object.keys(toOARecord(bare())).sort()).toEqual(
      ['authors', 'createdAt', 'id', 'source', 'sourceId', 'title'].sort()
    );
  });

  it('reports a merged paper under its first source', () => {
    const merged = paper({
      sources: [
        { provider: 'europepmc', nativeId: '42', rank: 0, retrievedAt: '2024-01-01T00:00:00.000Z' },
        { provider: 'ncbi', nativeId: '999', rank: 3, retrievedAt: '2024-01-01T00:00:00.000Z' }
      ]
    });

    const record = toOARecord(merged);
    expect(record.source).toBe('europepmc');
    expect(record.sourceId).toBe('42');
  });

  it('refuses a paper with no sources rather than inventing one', () => {
    expect(() => toOARecord(paper({ sources: [] }))).toThrow(/no sources/);
  });

  it.each([
    ['preprint', 'preprint'],
    ['accepted', 'accepted'],
    ['published', 'published']
  ] as Array<[PaperStage, OARecord['oaStatus']]>)(
    'reports stage %s as oaStatus %s',
    (stage, expected) => {
      expect(toOARecord(paper({ stage })).oaStatus).toBe(expected);
    }
  );

  it('leaves oaStatus off entirely for an unknown stage', () => {
    // `other` is a claim about a record, not an admission of not knowing, so
    // the absent field is what says the stage was never established.
    expect('oaStatus' in toOARecord(paper({ stage: 'unknown' }))).toBe(false);
  });

  it('drops the graded access route, which the old shape cannot express', () => {
    // `oaStatus` on an OARecord is the version, not the route. A paper Unpaywall
    // called `green` reports as `published` here, and the route is lost until
    // the response shape changes.
    const record = toOARecord(paper({ oaStatus: 'gold', stage: 'published' }));
    expect(record.oaStatus).toBe('published');
  });

  it('advertises the full text copy as the best pdf url', () => {
    expect(toOARecord(paper()).bestPdfUrl).toBe('https://example.org/paper.pdf');
    expect('bestPdfUrl' in toOARecord(bare())).toBe(false);
  });

  it('keeps a zero citation count, which is a measurement rather than a gap', () => {
    expect(toOARecord(paper({ citationCount: 0 })).citationCount).toBe(0);
  });

  it('omits topics when there are none, rather than sending an empty list', () => {
    expect('topics' in toOARecord(paper({ topics: [] }))).toBe(false);
  });

  it('dates the record from when the paper was retrieved', () => {
    const record = toOARecord(paper({ retrievedAt: '2025-06-01T12:00:00.000Z' }));
    expect(record.createdAt).toBe('2025-06-01T12:00:00.000Z');
  });
});
