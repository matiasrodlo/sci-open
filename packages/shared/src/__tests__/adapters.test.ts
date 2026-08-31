import { describe, it, expect } from 'vitest';
import type { OARecord, Paper } from '../index';
import { fromOARecord, toOARecord } from '../index';

/**
 * The property the phase-07 flag rests on: switching paths must not change the
 * response. If a field does not survive this round trip, results shift when
 * the flag moves and the comparison script cannot tell a real improvement from
 * an adapter bug.
 */

function record(over: Partial<OARecord> = {}): OARecord {
  return {
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
    sourceMetadata: { source: 'europepmc', latency: 421 },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-02-01T00:00:00.000Z',
    ...over
  } as OARecord;
}

describe('OARecord round trip', () => {
  it('preserves a fully populated record exactly', () => {
    const original = record();
    expect(toOARecord(fromOARecord(original))).toEqual(original);
  });

  it('preserves a record carrying only what OARecord requires', () => {
    const minimal: OARecord = {
      id: 'arxiv:2301.00001',
      title: 'Bare',
      authors: [],
      source: 'arxiv',
      sourceId: '2301.00001',
      createdAt: '2024-01-01T00:00:00.000Z'
    };
    expect(toOARecord(fromOARecord(minimal))).toEqual(minimal);
  });

  it.each(['preprint', 'accepted', 'published', 'other'] as const)(
    'preserves oaStatus %s',
    status => {
      const original = record({ oaStatus: status });
      expect(toOARecord(fromOARecord(original)).oaStatus).toBe(status);
    }
  );

  it('tells an absent oaStatus apart from an explicit "other"', () => {
    // Both map to stage 'unknown', so the adapter has to remember which it saw.
    const absent = record({ oaStatus: undefined });
    const other = record({ oaStatus: 'other' });

    expect('oaStatus' in toOARecord(fromOARecord(absent))).toBe(false);
    expect(toOARecord(fromOARecord(other)).oaStatus).toBe('other');
  });

  it('tells an absent topics list apart from an empty one', () => {
    const absent = record({ topics: undefined });
    const empty = record({ topics: [] });

    expect('topics' in toOARecord(fromOARecord(absent))).toBe(false);
    expect(toOARecord(fromOARecord(empty)).topics).toEqual([]);
  });

  it.each([
    ['no doi', { doi: undefined }],
    ['no abstract', { abstract: undefined }],
    ['no venue or publisher', { venue: undefined, publisher: undefined }],
    ['no pdf', { bestPdfUrl: undefined }],
    ['no landing page', { landingPage: undefined }],
    ['no citation count', { citationCount: undefined }],
    ['no source metadata', { sourceMetadata: undefined }],
    ['no updatedAt', { updatedAt: undefined }],
    ['zero citations', { citationCount: 0 }],
    ['empty authors', { authors: [] }]
  ])('preserves a record with %s', (_name, over) => {
    const original = record(over as Partial<OARecord>);
    expect(toOARecord(fromOARecord(original))).toEqual(original);
  });

  it('does not invent keys that were absent', () => {
    const minimal: OARecord = {
      id: 'arxiv:1',
      title: 'Bare',
      authors: [],
      source: 'arxiv',
      sourceId: '1',
      createdAt: '2024-01-01T00:00:00.000Z'
    };
    expect(Object.keys(toOARecord(fromOARecord(minimal))).sort()).toEqual(
      Object.keys(minimal).sort()
    );
  });
});

describe('fromOARecord', () => {
  it('makes the originating provider the only source', () => {
    const paper = fromOARecord(record(), 7);
    expect(paper.sources).toHaveLength(1);
    expect(paper.sources[0]).toEqual({
      provider: 'europepmc',
      nativeId: '42',
      rank: 7,
      retrievedAt: '2024-01-01T00:00:00.000Z',
      latency: 421
    });
  });

  it('attributes nothing, because a single-source record has nothing to choose between', () => {
    expect(fromOARecord(record()).fieldSources).toEqual({});
  });

  it('reads the legacy status as a version stage, not an access route', () => {
    // The old field held 'preprint' in the slot Unpaywall uses for 'gold'.
    // The route is genuinely unknown until Unpaywall is consulted.
    const paper = fromOARecord(record({ oaStatus: 'preprint' }));
    expect(paper.stage).toBe('preprint');
    expect(paper.oaStatus).toBe('unknown');
  });

  it('treats a pdf url as unverified full text', () => {
    // The provider claimed a PDF; nobody has fetched it. CORE claims plenty
    // that turn out to be HTML reader pages.
    expect(fromOARecord(record()).fullText).toEqual({
      url: 'https://example.org/paper.pdf',
      kind: 'pdf',
      verified: false
    });
  });

  it('leaves compat off entirely when there is nothing to carry', () => {
    const clean = fromOARecord({
      id: 'arxiv:1',
      title: 'Bare',
      authors: [],
      source: 'arxiv',
      sourceId: '1',
      createdAt: '2024-01-01T00:00:00.000Z'
    });
    expect(clean.compat).toBeUndefined();
  });
});

describe('toOARecord', () => {
  it('reports a merged paper under its first source', () => {
    const paper = fromOARecord(record());
    paper.sources.push({
      provider: 'ncbi',
      nativeId: '999',
      rank: 3,
      retrievedAt: '2024-01-01T00:00:00.000Z'
    });

    const back = toOARecord(paper);
    expect(back.source).toBe('europepmc');
    expect(back.sourceId).toBe('42');
  });

  it('refuses a paper with no sources rather than inventing one', () => {
    const orphan = { ...fromOARecord(record()), sources: [] } as Paper;
    expect(() => toOARecord(orphan)).toThrow(/no sources/);
  });

  it('derives the legacy status from stage for a paper the orchestrator built', () => {
    // No compat, because it was never an OARecord.
    const built: Paper = {
      id: 'x:1',
      title: 'Built',
      authors: [],
      topics: [],
      oaStatus: 'green',
      stage: 'preprint',
      sources: [{ provider: 'arxiv', nativeId: '1', rank: 0, retrievedAt: '2024-01-01T00:00:00.000Z' }],
      fieldSources: {},
      retrievedAt: '2024-01-01T00:00:00.000Z'
    };
    expect(toOARecord(built).oaStatus).toBe('preprint');
  });
});
