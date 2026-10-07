import type { Paper, SourceRef } from '@sci-open/shared';
import { normalizeWork } from '../../authorities/crossref/normalize';

/**
 * Crossref works -> Papers. Pure. The fields are read as the authority reads
 * them (`normalizeWork`), so a paper this provider found and one it enriched
 * say the same about it.
 */

export type SkippedRecord = { index: number; nativeId?: string; reason: string };

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number };

export function normalize(works: readonly unknown[], options: NormalizeOptions): { papers: Paper[]; skipped: SkippedRecord[] } {
  const { retrievedAt, rankOffset = 0 } = options;
  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  works.forEach((work: any, index) => {
    const doi = typeof work?.DOI === 'string' ? work.DOI.trim() : '';
    if (!doi) {
      skipped.push({ index: rankOffset + index, reason: 'no DOI' });
      return;
    }
    const facts = normalizeWork(work);
    if (!facts.title) {
      skipped.push({ index: rankOffset + index, nativeId: doi, reason: 'no title' });
      return;
    }
    const ref: SourceRef = { provider: 'crossref', nativeId: doi, rank: rankOffset + index, retrievedAt };
    const { title, authors, topics, stage, ...rest } = facts;
    papers.push({
      ...rest,
      id: `crossref:${doi}`,
      doi,
      title,
      authors: authors ?? [],
      topics: topics ?? [],
      // Crossref says whether a paper is open for none of them: Unpaywall,
      // the authority, does.
      oaStatus: 'unknown',
      stage: stage ?? 'unknown',
      sources: [ref],
      fieldSources: {}
    });
  });

  return { papers, skipped };
}
