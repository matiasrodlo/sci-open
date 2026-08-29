import type { Paper, FullText, OaRoute, SourceRef } from '@open-access-explorer/shared';
import type { OpenAirePayload } from './fetch';

/**
 * OpenAIRE payload -> Paper[]. Pure, and isolated per record.
 *
 * Every field in this API is either a bare value or an object carrying its
 * text under `$` and its attributes under `@`-prefixed keys. The old connector
 * reached for the xml2js spelling of that — `$.classid` and `_` — which is the
 * shape the XML endpoint produces, not the JSON one. It had already been
 * corrected for `bestaccessright` and nowhere else, so several fields read
 * from keys that are never present.
 */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The text of a node, whether it is bare or wrapped in `{ $: ... }`. */
function value(node: any): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && node.$ !== undefined && node.$ !== null) {
    // `pmid` arrives as a number, so this cannot assume a string.
    return typeof node.$ === 'string' ? node.$.trim() || undefined : String(node.$);
  }
  return undefined;
}

/** An `@`-prefixed attribute. */
function attr(node: any, name: string): string | undefined {
  const raw = node?.[`@${name}`];
  return typeof raw === 'string' ? raw.trim() || undefined : undefined;
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The DOI, from `pid[]`.
 *
 * The identifier is under `@classid` and `$`; the old connector read
 * `$.classid` and `_`, so it never matched and no OpenAIRE record carried a
 * DOI — which meant none of them could deduplicate against any other provider.
 * Exactly the fix already applied to `bestaccessright`, in the place it was
 * missed.
 */
function pickDoi(result: any): string | undefined {
  const pids = asArray(result?.pid);
  const doi = pids.find(p => attr(p, 'classid') === 'doi');
  return value(doi);
}

/**
 * The open-access route, which OpenAIRE actually reports.
 *
 * `openaccesscolor` holds `gold`, `hybrid` or `bronze` — the same vocabulary
 * `oaStatus` uses — and `isgreen` covers the repository case. Everywhere else
 * this field waits for Unpaywall; here it is data.
 */
const ROUTES: readonly OaRoute[] = ['gold', 'green', 'hybrid', 'bronze'];

function pickRoute(result: any): OaRoute {
  const access = (attr(result?.bestaccessright, 'classid') ?? '').toLowerCase();
  const isOpen = access.includes('open');
  if (!isOpen && access) return 'closed';

  const colour = value(result?.openaccesscolor)?.toLowerCase() as OaRoute | undefined;
  if (colour && ROUTES.includes(colour)) return colour;

  if (value(result?.isgreen) === 'true') return 'green';

  return isOpen ? 'unknown' : 'closed';
}

function pickFullText(result: any): FullText | undefined {
  const instances = asArray(result?.children?.instance);
  const urls = instances.flatMap(instance =>
    asArray(instance?.webresource).map(w => value(w?.url)).filter(Boolean)
  ) as string[];

  const pdf = urls.find(u => u.toLowerCase().endsWith('.pdf'));
  if (pdf) return { url: pdf, kind: 'pdf', verified: false };

  const any = urls[0];
  return any ? { url: any, kind: 'html', verified: false } : undefined;
}

/** Subject terms: FOS classifications and author keywords alike. */
function pickTopics(result: any): string[] {
  const seen = new Set<string>();
  return asArray(result?.subject)
    .map(value)
    .filter((t): t is string => Boolean(t))
    .filter(term => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const result = raw?.metadata?.['oaf:entity']?.['oaf:result'];
  if (!result) throw new Error('record has no oaf:result');

  const title = value(asArray(result.title)[0]);
  if (!title) throw new Error('record has no title');

  const nativeId = ref.nativeId;
  if (!nativeId) throw new Error('record has no objIdentifier');

  const doi = pickDoi(result);
  const abstract = value(asArray(result.description)[0]);
  const accepted = value(result.dateofacceptance);
  const year = Number.parseInt(accepted?.slice(0, 4) ?? '', 10);
  const fullText = pickFullText(result);

  return {
    id: `openaire:${nativeId}`,
    ...(doi ? { doi } : {}),
    title: stripMarkup(title),
    authors: asArray(result.creator).map(value).filter((a): a is string => Boolean(a)),
    ...(Number.isFinite(year) ? { year } : {}),
    // The journal, not the publishing house. The old connector assigned
    // `publisher` to both, so every venue read "Elsevier BV" and the like.
    ...(value(result.journal) ? { venue: value(result.journal)! } : {}),
    ...(value(result.publisher) ? { publisher: value(result.publisher)! } : {}),
    ...(abstract ? { abstract: stripMarkup(abstract) } : {}),
    topics: pickTopics(result),
    // `@classid` — the old connector read `$`, which is the language *name*
    // slot and absent here, so every record fell back to 'en'.
    ...(attr(result.language, 'classid') ? { language: attr(result.language, 'classid')! } : {}),

    oaStatus: pickRoute(result),
    // `refereed: peerReviewed` is the only version signal OpenAIRE gives.
    stage: attr(asArray(result.children?.instance)[0]?.refereed, 'classname') === 'peerReviewed'
      ? 'published'
      : 'unknown',
    ...(fullText ? { fullText } : {}),
    landingPage:
      value(asArray(asArray(result.children?.instance)[0]?.webresource)[0]?.url) ??
      (doi
        ? `https://doi.org/${doi}`
        : `https://explore.openaire.eu/search/publication?articleId=${nativeId}`),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: OpenAirePayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = asArray(payload?.response?.results?.result);

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((raw: any, index) => {
    // `dri:objIdentifier` — one key with a prefix in its name, not a `dri`
    // object with an `objIdentifier` inside it. The old connector read the
    // latter, found nothing, and fell back to a 50-character slug of the
    // title as the record's identifier.
    const nativeId = value(raw?.header?.['dri:objIdentifier']) ?? '';

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
      // Per record. The old normaliser threw on a missing `oaf:result` and
      // nothing caught it, so one malformed record discarded the whole page.
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
  const reported = Number(value(payload?.response?.header?.total));
  return Number.isFinite(reported) ? reported : undefined;
}
