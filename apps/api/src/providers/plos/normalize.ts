import type { Paper, SourceRef } from '@open-access-explorer/shared';
import type { PlosPayload } from './fetch';

/** PLOS Solr payload -> Paper[]. Pure, and isolated per record. */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: unknown): string | undefined {
  const [v] = asArray(value as any);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * The leaf of each PLOS subject path.
 *
 * `subject` holds hierarchical strings such as
 * `/Biology and life sciences/Genetics/Genomics/Repeated sequences/CRISPRs`.
 * The leaf is the specific thing the paper is about; the full path would make
 * every level its own facet bucket, which is the failure phase 03 measured as
 * a topics facet with 3,079 buckets behind a UI that shows 15.
 *
 * The old connector put `article_type` here instead, so every PLOS record
 * carried the single topic "Research Article" — a document type, not a
 * subject, and identical across the whole corpus.
 */
function pickTopics(doc: any): string[] {
  const seen = new Set<string>();
  return asArray<string>(doc?.subject)
    .filter(s => typeof s === 'string')
    .map(path => path.split('/').filter(Boolean).pop() ?? '')
    .filter(term => {
      if (!term) return false;
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeOne(doc: any, ref: SourceRef): Paper {
  const nativeId = typeof doc?.id === 'string' ? doc.id : '';
  if (!nativeId) throw new Error('record has no id');

  const title = first(doc.title_display) ?? first(doc.title);
  if (!title) throw new Error('record has no title');

  // PLOS returns the DOI as a single-element array.
  const doi = first(doc.doi);
  const year = Number.parseInt(String(doc.publication_date ?? '').slice(0, 4), 10);

  const authors = asArray<string>(doc.author_display).length
    ? asArray<string>(doc.author_display)
    : asArray<string>(doc.author);

  return {
    id: `plos:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: authors.filter(a => typeof a === 'string' && a.trim()),
    ...(Number.isFinite(year) ? { year } : {}),
    ...(doc.journal ? { venue: String(doc.journal) } : {}),
    // PLOS is the publisher of every record it returns.
    publisher: 'Public Library of Science',
    // Trimmed: Solr returns the abstract with the source document's leading
    // newline and indentation still on it.
    ...(first(doc.abstract) ? { abstract: first(doc.abstract)! } : {}),
    topics: pickTopics(doc),
    // PLOS publishes in English and reports no language field.
    language: 'en',

    // Every PLOS journal is fully open access, so the route is known rather
    // than guessed — the same case as DOAJ.
    oaStatus: 'gold',
    stage: 'published',
    // PLOS serves the PDF off the DOI. The journal slug in the path is not
    // load-bearing: `/plosone/` resolves a PLOS Genetics or PLOS Biology DOI
    // to the right file, checked on both.
    ...(doi
      ? {
          fullText: {
            url: `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`,
            kind: 'pdf' as const,
            verified: false
          }
        }
      : {}),
    ...(doi ? { landingPage: `https://doi.org/${doi}` } : {}),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: PlosPayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const docs = payload?.response?.docs ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  docs.forEach((doc: any, index) => {
    const nativeId = typeof doc?.id === 'string' ? doc.id : '';
    const ref: SourceRef = {
      provider: 'plos',
      nativeId,
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(doc, ref));
    } catch (error) {
      skipped.push({
        index: rankOffset + index,
        ...(nativeId ? { nativeId } : {}),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { papers, skipped };
}

/** PLOS's own count for this query. */
export function totalHits(payload: PlosPayload): number | undefined {
  const reported = Number(payload?.response?.numFound);
  return Number.isFinite(reported) ? reported : undefined;
}
