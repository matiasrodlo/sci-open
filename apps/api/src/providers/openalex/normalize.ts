import type { Paper, PaperStage, FullText, OaRoute, SourceRef } from '@open-access-explorer/shared';
import type { OpenAlexPayload } from './fetch';

/** OpenAlex payload -> Paper[]. Pure, and isolated per record. */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** OpenAlex returns its own ids and DOIs as full URLs. */
const stripPrefix = (value: string, prefix: RegExp) => value.replace(prefix, '');

/**
 * Rebuilds the abstract from OpenAlex's inverted index.
 *
 * A word can appear at several positions and every one of them has to be
 * emitted, which is why the positions are flattened rather than deduplicated.
 * (Phase 00 checked this and found all three existing implementations already
 * correct — the claim that repeated words were being dropped was wrong.)
 *
 * `abstract_inverted_index` is `null` on records OpenAlex cannot redistribute
 * an abstract for, which is one of the three in the recorded fixture.
 */
export function reconstructAbstract(index: unknown): string | undefined {
  if (!index || typeof index !== 'object') return undefined;

  const words: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(index as Record<string, number[]>)) {
    for (const position of asArray(positions)) {
      if (typeof position === 'number') words.push({ word, position });
    }
  }
  if (words.length === 0) return undefined;

  words.sort((a, b) => a.position - b.position);
  return words.map(w => w.word).join(' ');
}

/**
 * The open-access route, which OpenAlex reports directly.
 *
 * `open_access.oa_status` is Unpaywall's vocabulary — the recorded page alone
 * carries `green` and `bronze` — so this is data rather than an inference. The
 * old path threw it away and wrote `oaStatus: 'published'` on every record,
 * which is a *stage* wearing the route's name: the exact conflation `Paper`
 * splits into two fields.
 */
const ROUTES = new Set<OaRoute>(['gold', 'green', 'hybrid', 'bronze', 'closed']);

function pickRoute(work: any): OaRoute {
  const status = String(work?.open_access?.oa_status ?? '').toLowerCase();
  return ROUTES.has(status as OaRoute) ? (status as OaRoute) : 'unknown';
}

/** OpenAlex's `type` is the closest thing it reports to a version. */
const STAGES: Record<string, PaperStage> = {
  article: 'published',
  preprint: 'preprint',
  'book-chapter': 'published',
  book: 'published',
  dissertation: 'published',
  report: 'published',
  paratext: 'unknown'
};

function pickFullText(work: any): FullText | undefined {
  // `best_oa_location.pdf_url` is a PDF by construction. `oa_url` is whatever
  // route OpenAlex found, which is often a landing page — the recorded page has
  // one pointing at a PMC article — so it is only called a PDF when it looks
  // like one.
  const pdf = work?.best_oa_location?.pdf_url;
  if (typeof pdf === 'string' && pdf) return { url: pdf, kind: 'pdf', verified: false };

  const oaUrl = work?.open_access?.oa_url;
  if (typeof oaUrl === 'string' && oaUrl) {
    const kind = oaUrl.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html';
    return { url: oaUrl, kind, verified: false };
  }

  return undefined;
}

/**
 * OpenAlex's curated topics, and deliberately not its keywords.
 *
 * `topics` supersedes the `concepts` the old path used, and the point of
 * moving is precision: 3 topics against 11 concepts on the same record.
 * Folding `keywords` in as well would put the count back to 14 and give up
 * exactly what the change was for — phase 03 measured the topics facet at
 * 3,079 buckets behind a UI that shows 15.
 */
function pickTopics(work: any): string[] {
  const seen = new Set<string>();
  return asArray<any>(work?.topics)
    .map(t => t?.display_name)
    .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    .filter(term => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeOne(work: any, ref: SourceRef): Paper {
  const nativeId = ref.nativeId;
  if (!nativeId) throw new Error('record has no id');

  const title = typeof work?.title === 'string' && work.title.trim()
    ? work.title.trim()
    : typeof work?.display_name === 'string' ? work.display_name.trim() : '';
  if (!title) throw new Error('record has no title');

  const doi = typeof work?.doi === 'string'
    ? stripPrefix(work.doi, /^https?:\/\/(?:dx\.)?doi\.org\//i)
    : undefined;

  const source = work?.primary_location?.source ?? {};
  const year = Number(work?.publication_year);
  const citationCount = Number(work?.cited_by_count);
  const fullText = pickFullText(work);

  return {
    id: `openalex:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: asArray<any>(work?.authorships)
      .map(a => a?.author?.display_name)
      .filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0),
    ...(Number.isFinite(year) ? { year } : {}),
    ...(source.display_name ? { venue: String(source.display_name) } : {}),
    // `host_organization_name`, and there is no alternative. The old path read
    // `host_venue.publisher`; `host_venue` is not a valid select field at all,
    // so OpenAlex answers `select=host_venue` with HTTP 400. The obvious
    // substitute, `primary_location.source.publisher`, is not a field either —
    // the source object carries no such key. This one was populated on every
    // record measured.
    ...(source.host_organization_name
      ? { publisher: String(source.host_organization_name) }
      : {}),
    ...(reconstructAbstract(work?.abstract_inverted_index)
      ? { abstract: reconstructAbstract(work.abstract_inverted_index)! }
      : {}),
    topics: pickTopics(work),
    ...(work?.language ? { language: String(work.language) } : {}),
    ...(Number.isFinite(citationCount) ? { citationCount } : {}),

    oaStatus: pickRoute(work),
    stage: STAGES[String(work?.type ?? '')] ?? 'unknown',
    ...(fullText ? { fullText } : {}),
    // The DOI resolves to the publisher's page; the OpenAlex record is the
    // fallback. The old path used the OpenAlex URL even when a DOI was present.
    landingPage: doi ? `https://doi.org/${doi}` : `https://openalex.org/${nativeId}`,

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: OpenAlexPayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = payload?.results ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((work: any, index) => {
    const nativeId = typeof work?.id === 'string'
      ? stripPrefix(work.id, /^https?:\/\/openalex\.org\//i)
      : '';

    const ref: SourceRef = {
      provider: 'openalex',
      nativeId,
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(work, ref));
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

/** OpenAlex's own count for this query. */
export function totalHits(payload: OpenAlexPayload): number | undefined {
  const reported = Number(payload?.meta?.count);
  return Number.isFinite(reported) ? reported : undefined;
}
