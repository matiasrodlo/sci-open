import type { Paper, FullText, OaRoute, SourceRef } from '@open-access-explorer/shared';
import { fullTextAt, httpUrl, stripMarkup } from '@open-access-explorer/shared';
import type { OpenAirePayload } from './fetch';

/**
 * OpenAIRE Graph API payload -> Paper[]. Pure, and isolated per record.
 *
 * A research product from `/graph/v1/researchProducts` is plain JSON: values
 * are bare strings, lists are always lists, and nothing is wrapped in the
 * `{ $: … }` / `@attr` shape the legacy search endpoint used. What remains
 * awkward is below — optional fields arrive as `null` rather than absent, and
 * some lists carry entries that are not what their name says.
 */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A non-empty trimmed string, or nothing. Numbers are not text here. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

/** The DOI, from `pids[]`, which also carries PMIDs and PMC ids. */
function pickDoi(record: any): string | undefined {
  return text(asArray(record?.pids).find((p: any) => text(p?.scheme)?.toLowerCase() === 'doi')?.value);
}

/**
 * The open-access route, which OpenAIRE actually reports.
 *
 * `openAccessColor` holds `gold`, `hybrid` or `bronze` — the same vocabulary
 * `oaStatus` uses — and `isGreen` covers the repository case. Everywhere else
 * this field waits for Unpaywall; here it is data.
 */
const ROUTES: readonly OaRoute[] = ['gold', 'green', 'hybrid', 'bronze'];

function pickRoute(record: any): OaRoute {
  // `OPEN`, `OPEN SOURCE`, `CLOSED`, `RESTRICTED`, `EMBARGO` — COAR's access
  // rights, by label.
  const access = (text(record?.bestAccessRight?.label) ?? '').toLowerCase();
  const isOpen = access.includes('open');
  if (!isOpen && access) return 'closed';

  const colour = text(record?.openAccessColor)?.toLowerCase() as OaRoute | undefined;
  if (colour && ROUTES.includes(colour)) return colour;

  if (record?.isGreen === true) return 'green';

  return isOpen ? 'unknown' : 'closed';
}

/** Every URL any instance lists, in the order OpenAIRE gives them. */
function instanceUrls(record: any): string[] {
  return asArray(record?.instances).flatMap((instance: any) =>
    asArray(instance?.urls).map(u => httpUrl(text(u))).filter(Boolean)
  ) as string[];
}

function pickFullText(record: any): FullText | undefined {
  const urls = instanceUrls(record);

  const pdf = urls.find(u => u.toLowerCase().endsWith('.pdf'));
  const fromPdf = fullTextAt(pdf, 'pdf');
  if (fromPdf) return fromPdf;

  // `urls[0]` is whatever the first instance listed, and for an OpenAIRE
  // record that is very often the DOI it is also filed under — the same string
  // this normaliser writes to `landingPage` a few lines below. `fullTextAt` is
  // what stops the landing page being counted twice, once as the address and
  // once as the copy.
  return urls.map(u => fullTextAt(u, 'html')).find(Boolean);
}

/** Subject terms: FOS classifications and author keywords alike. */
function pickTopics(record: any): string[] {
  const seen = new Set<string>();
  return asArray(record?.subjects)
    .map((s: any) => text(s?.subject?.value))
    .filter((t): t is string => Boolean(t))
    .filter(term => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The abstract, out of however many `descriptions` there are.
 *
 * Not `descriptions[0]`. OpenAIRE puts stray values in that list: one record
 * for `alzheimer amyloid beta` carried a bare `75` — presumably a page count —
 * ahead of the abstract. Taking the first entry made the old connector throw,
 * which cost it the whole page, and made this provider report an abstract of
 * `"75"`. A value that is nothing but digits is not a description, so it is
 * skipped and OpenAIRE's own ordering decides among the rest.
 */
function pickAbstract(record: any): string | undefined {
  for (const entry of asArray(record?.descriptions)) {
    const value = typeof entry === 'number' ? String(entry) : text(entry);
    if (value && !/^\d+$/.test(value)) return value;
  }
  return undefined;
}

function normalizeOne(record: any, ref: SourceRef): Paper {
  if (!record || typeof record !== 'object') throw new Error('record is not an object');

  // `mainTitle`, which the Graph API separates from `subTitle` itself. The
  // legacy endpoint mixed both into one `title` list and they had to be told
  // apart by tag. Stripped before the emptiness check, not after: a title that
  // is nothing but markup is a record with no title.
  const title = stripMarkup(text(record.mainTitle));
  if (!title) throw new Error('record has no title');

  const nativeId = ref.nativeId;
  if (!nativeId) throw new Error('record has no id');

  const doi = pickDoi(record);
  const abstract = stripMarkup(pickAbstract(record));
  const year = Number.parseInt(text(record.publicationDate)?.slice(0, 4) ?? '', 10);
  const fullText = pickFullText(record);
  const firstInstance = asArray(record.instances)[0] as any;
  const venue = text(record.container?.name);
  const publisher = text(record.publisher);
  const language = text(record.language?.code);

  return {
    id: `openaire:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: asArray(record.authors)
      .map((a: any) => text(a?.fullName))
      .filter((a): a is string => Boolean(a)),
    ...(Number.isFinite(year) ? { year } : {}),
    // The journal, not the publishing house. The old connector assigned
    // `publisher` to both, so every venue read "Elsevier BV" and the like.
    ...(venue ? { venue } : {}),
    ...(publisher ? { publisher } : {}),
    ...(abstract ? { abstract } : {}),
    topics: pickTopics(record),
    // The code (`eng`), not the label (`English`).
    ...(language ? { language } : {}),

    oaStatus: pickRoute(record),
    // `refereed: peerReviewed` is the only version signal OpenAIRE gives.
    stage: text(firstInstance?.refereed) === 'peerReviewed' ? 'published' : 'unknown',
    ...(fullText ? { fullText } : {}),
    landingPage:
      httpUrl(text(asArray(firstInstance?.urls)[0])) ??
      (doi
        ? `https://doi.org/${doi}`
        : `https://explore.openaire.eu/search/publication?articleId=${nativeId}`),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

/** One record the way `normalize` reads a page's worth — for the by-id lookup. */
export function normalizeRecord(record: unknown, options: NormalizeOptions): NormalizeOutcome {
  return normalize({ results: [record] }, options);
}

export function normalize(payload: OpenAirePayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = asArray(payload?.results as unknown[] | undefined);

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((raw: any, index) => {
    // The same identifier the legacy endpoint carried as `dri:objIdentifier`
    // — `doi_dedup___::…` and the like — so ids handed out before the switch
    // still resolve.
    const nativeId = text(raw?.id) ?? '';

    const ref: SourceRef = {
      provider: 'openaire',
      nativeId,
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(raw, ref));
    } catch (error) {
      // Per record. The old normaliser threw on a malformed record and nothing
      // caught it, so one bad record discarded the whole page.
      skipped.push({
        index: rankOffset + index,
        ...(nativeId ? { nativeId } : {}),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { papers, skipped };
}

/** OpenAIRE's own count for this query. */
export function totalHits(payload: OpenAirePayload): number | undefined {
  const reported = payload?.header?.numFound;
  if (reported === undefined || reported === null) return undefined;
  const count = Number(reported);
  return Number.isFinite(count) ? count : undefined;
}
