import { describe, it, expect } from 'vitest';
import type { OARecord, OASource } from '@open-access-explorer/shared';
import { RecordMerger } from '../merge';

function record(over: Partial<OARecord> & { source: OASource; sourceId: string }): OARecord {
  return {
    id: `${over.source}:${over.sourceId}`,
    title: 'A study of things',
    authors: ['Ada Lovelace'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over
  } as OARecord;
}

describe('RecordMerger.deduplicate — DOI grouping', () => {
  it('collapses records sharing a DOI into one', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: '1', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: '2', doi: '10.1/abc' })
    ]);
    expect(out).toHaveLength(1);
  });

  it('treats DOIs case-insensitively and ignores a doi.org prefix', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: '1', doi: '10.1/ABC' }),
      record({ source: 'ncbi', sourceId: '2', doi: 'https://doi.org/10.1/abc' })
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps records with different DOIs apart', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: '1', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: '2', doi: '10.1/def' })
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('RecordMerger.deduplicate — records without a DOI', () => {
  it('groups them on title and year', () => {
    // arXiv supplies no DOI. Without this fallback the same preprint returned
    // by two sources appears twice in one result set.
    const out = new RecordMerger().deduplicate([
      record({ source: 'arxiv', sourceId: '1', title: 'Attention Is All You Need', year: 2017 }),
      record({ source: 'openaire', sourceId: '2', title: 'attention is all you need!', year: 2017 })
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps same-titled records from different years apart', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'arxiv', sourceId: '1', title: 'Annual Report', year: 2017 }),
      record({ source: 'arxiv', sourceId: '2', title: 'Annual Report', year: 2018 })
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not merge a record that has a DOI with one that does not', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: '1', title: 'Same Title', year: 2020, doi: '10.1/abc' }),
      record({ source: 'arxiv', sourceId: '2', title: 'Same Title', year: 2020 })
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('RecordMerger.deduplicate — merge priority', () => {
  it('keeps the higher-priority source as the primary record', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'ncbi', sourceId: 'low', doi: '10.1/abc', title: 'From NCBI' }),
      record({ source: 'europepmc', sourceId: 'high', doi: '10.1/abc', title: 'From Europe PMC' })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('From Europe PMC');
  });

  it('routes a merged-in abstract to canonicalAbstract, not abstract', () => {
    // Pins current behaviour. `preferCanonical` defaults to true, so every
    // field contributed by a secondary record is written to its `canonical*`
    // twin rather than to the field itself.
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: 'high', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: 'low', doi: '10.1/abc', abstract: 'Only NCBI had this' })
    ]);
    expect(out[0].canonicalAbstract).toBe('Only NCBI had this');
  });

  it('does merge a field the primary lacks when preferCanonical is off', () => {
    const out = new RecordMerger({ preferCanonical: false }).deduplicate([
      record({ source: 'europepmc', sourceId: 'high', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: 'low', doi: '10.1/abc', abstract: 'Only NCBI had this' })
    ]);
    expect(out[0].abstract).toBe('Only NCBI had this');
  });

  /**
   * KNOWN DEFECT — flips to passing when phase 6 rebuilds the merge step.
   *
   * Of the five `canonical*` fields the merger writes, only `canonicalVenue`
   * is ever read back (enhanced-search-pipeline.ts, for the venue facet).
   * `canonicalAbstract`, `canonicalTitle`, `canonicalAuthors` and
   * `canonicalYear` are written and never read, while every consumer — the
   * search response, the exports, the citation formatters, the UI — reads
   * `record.abstract`.
   *
   * So when one provider has the record and another has the abstract, the
   * merged record is returned with no abstract at all. This is the same shape
   * as the bestPdfUrl/pdfUrl bug, in the fields next to it.
   */
  it.fails('surfaces a merged-in abstract on the field consumers actually read', () => {
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: 'high', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: 'low', doi: '10.1/abc', abstract: 'Only NCBI had this' })
    ]);
    expect(out[0].abstract).toBe('Only NCBI had this');
  });

  it('keeps bestPdfUrl in step with pdfUrl when merging', () => {
    // bestPdfUrl is the field consumers read. A record that carried the merged
    // URL only on pdfUrl reads downstream as having no PDF at all.
    const out = new RecordMerger().deduplicate([
      record({ source: 'europepmc', sourceId: 'a', doi: '10.1/abc' }),
      record({ source: 'ncbi', sourceId: 'b', doi: '10.1/abc', bestPdfUrl: 'https://example.org/x.pdf' })
    ]);
    expect(out[0].bestPdfUrl).toBe('https://example.org/x.pdf');
    expect(out[0].pdfUrl).toBe('https://example.org/x.pdf');
  });
});

describe('RecordMerger.deduplicate — edges', () => {
  it('returns an empty array for no input', () => {
    expect(new RecordMerger().deduplicate([])).toEqual([]);
  });

  it('never returns more records than it was given', () => {
    const input = [
      record({ source: 'europepmc', sourceId: '1', doi: '10.1/a' }),
      record({ source: 'ncbi', sourceId: '2', doi: '10.1/a' }),
      record({ source: 'arxiv', sourceId: '3', title: 'Other', year: 2020 })
    ];
    expect(new RecordMerger().deduplicate(input).length).toBeLessThanOrEqual(input.length);
  });
});
