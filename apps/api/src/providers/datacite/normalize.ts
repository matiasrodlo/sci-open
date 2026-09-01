import type { Paper, PaperStage, FullText, SourceRef } from '@open-access-explorer/shared';
import { httpUrl } from '@open-access-explorer/shared';
import type { DataCitePayload } from './fetch';

/**
 * DataCite payload -> Paper[]. Pure, and isolated per record.
 *
 * DataCite is a DOI registry rather than a full-text host, and describing it
 * honestly is most of the work here. Measured on 100 live records: one carried
 * `application/pdf` in `formats`, none carried an `IsPublishedIn` relation,
 * and no `url` ended in `.pdf` — every one of them points at a repository
 * landing page. The old connector encoded that as `oaStatus: 'other'` and no
 * PDF on every record, which the two hard filters then dropped: 600 records
 * retrieved, none surviving.
 *
 * Nothing here tries to make those records look retrievable. The landing page
 * is a landing page, and whether such a record is worth returning is the
 * policy filter's decision, not the provider's.
 */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Which version this is, from `resourceTypeGeneral`.
 *
 * Real information the old connector ignored: it derived `oaStatus` from
 * whether an `IsPublishedIn` relation existed, which on 100 live records was
 * never. The type field says `Preprint` for 26 of them.
 */
const STAGES: Record<string, PaperStage> = {
  Preprint: 'preprint',
  JournalArticle: 'published',
  ConferenceProceeding: 'published',
  BookChapter: 'published',
  Book: 'published',
  Dissertation: 'published',
  Report: 'published'
};

/**
 * Resource types that are not papers.
 *
 * 11 of 100 live records are datasets, and the rest of these appear too. They
 * are legitimate DataCite records and they are not what a literature search is
 * looking for, so they are skipped with the type named rather than returned
 * and left for a filter that has no way to recognise them.
 */
const NOT_A_PAPER = new Set([
  'Dataset',
  'Software',
  'Collection',
  'Image',
  'Audiovisual',
  'Workflow',
  'PhysicalObject',
  'Service',
  'Model',
  'Sound'
]);

function pickFullText(attrs: any): FullText | undefined {
  const url = httpUrl(attrs?.url);
  if (!url) return undefined;

  // Only when DataCite says so, or the URL is plainly one. The old connector
  // reached the same conclusion by a narrower route and then wrote the result
  // into `bestPdfUrl` regardless of whether it was reachable.
  const isPdf =
    asArray<string>(attrs?.formats).includes('application/pdf') ||
    url.toLowerCase().endsWith('.pdf');

  return isPdf ? { url, kind: 'pdf', verified: false } : undefined;
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const nativeId = typeof raw?.id === 'string' ? raw.id : '';
  if (!nativeId) throw new Error('record has no id');

  const attrs = raw?.attributes ?? {};

  const resourceType = attrs?.types?.resourceTypeGeneral;
  if (typeof resourceType === 'string' && NOT_A_PAPER.has(resourceType)) {
    throw new Error(`not a paper: ${resourceType}`);
  }

  // No 'Untitled' default. The old connector used one, which turns an
  // unreadable record into a result rather than a reported skip.
  const title = asArray<any>(attrs.titles)[0]?.title;
  if (typeof title !== 'string' || !title.trim()) throw new Error('record has no title');

  const doi = typeof attrs.doi === 'string' ? attrs.doi : undefined;
  const year = Number(attrs.publicationYear);

  const abstract = asArray<any>(attrs.descriptions).find(
    d => d?.descriptionType === 'Abstract' || !d?.descriptionType
  )?.description;

  const fullText = pickFullText(attrs);

  return {
    id: `datacite:${nativeId}`,
    ...(doi ? { doi } : {}),
    title: title.trim(),
    authors: asArray<any>(attrs.creators)
      .map(c =>
        typeof c?.name === 'string' && c.name.trim()
          ? c.name.trim()
          : `${c?.givenName ?? ''} ${c?.familyName ?? ''}`.trim()
      )
      .filter(Boolean),
    ...(Number.isFinite(year) ? { year } : {}),
    // DataCite records the repository or publisher that registered the DOI.
    // The old connector fell back to the literal string 'DataCite Repository',
    // which is a fabricated venue.
    ...(attrs.publisher ? { publisher: String(attrs.publisher) } : {}),
    ...(abstract ? { abstract: String(abstract) } : {}),
    topics: asArray<any>(attrs.subjects)
      .map(s => s?.subject)
      .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0),
    ...(attrs.language ? { language: String(attrs.language) } : {}),

    // DataCite reports no access route at all, so this waits for enrichment
    // rather than being guessed from the absence of a relation.
    oaStatus: 'unknown',
    stage: STAGES[resourceType as string] ?? 'unknown',
    ...(fullText ? { fullText } : {}),
    // The registered URL is a landing page. On 100 live records not one ended
    // in `.pdf`.
    ...(httpUrl(attrs.url)
      ? { landingPage: httpUrl(attrs.url)! }
      : doi
        ? { landingPage: `https://doi.org/${doi}` }
        : {}),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: DataCitePayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const data = payload?.data ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  data.forEach((raw: any, index) => {
    const nativeId = typeof raw?.id === 'string' ? raw.id : '';
    const ref: SourceRef = {
      provider: 'datacite',
      nativeId,
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(raw, ref));
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

export function totalHits(payload: DataCitePayload): number | undefined {
  const reported = Number(payload?.meta?.total);
  return Number.isFinite(reported) ? reported : undefined;
}
