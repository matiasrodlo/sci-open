import type { Paper, FullText, SourceRef } from '@open-access-explorer/shared';
import type { DoajPayload } from './fetch';

/**
 * DOAJ payload -> Paper[]. Pure, and isolated per record.
 */

export type NormalizeOptions = {
  retrievedAt: string;
  rankOffset?: number;
  latency?: number;
};

export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

type DoajLink = { type?: string; content_type?: string; url?: string };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A retrievable copy, and only when it is actually one.
 *
 * The old connector matched `link.type === 'fulltext' || content_type ===
 * 'application/pdf'` and wrote the result to `bestPdfUrl`. In the recorded
 * fixture every link is `type: 'fulltext'` and not one is a PDF — one is
 * explicitly `text/html` — so every DOAJ record advertised a journal landing
 * page as its PDF. `type: 'fulltext'` says a full text exists somewhere, not
 * what format it is in.
 *
 * `verified` is false regardless: a provider naming a format is not the same
 * as having fetched the file.
 */
function pickFullText(links: DoajLink[]): FullText | undefined {
  const pdf = links.find(
    l => l.content_type === 'application/pdf' || l.url?.toLowerCase().endsWith('.pdf')
  );
  if (pdf?.url) return { url: pdf.url, kind: 'pdf', verified: false };

  const html = links.find(l => l.content_type === 'text/html' || l.type === 'fulltext');
  if (html?.url) return { url: html.url, kind: 'html', verified: false };

  return undefined;
}

/**
 * The canonical page for a human.
 *
 * The DOI first, because it is the stable identifier and resolves to the same
 * publisher page the fulltext link points at directly. The link itself is not
 * discarded — it is carried by `fullText`, filed under the format it actually
 * is, which is the whole point of separating the two.
 */
function pickLandingPage(links: DoajLink[], doi: string | undefined, id: string): string {
  if (doi) return `https://doi.org/${doi}`;
  const fulltext = links.find(l => l.type === 'fulltext')?.url;
  if (fulltext) return fulltext;
  return `https://doaj.org/article/${id}`;
}

/** Author keywords, then the journal's LCC subject terms. */
function pickTopics(bibjson: any): string[] {
  const keywords = asArray<string>(bibjson?.keywords).filter(k => typeof k === 'string');
  const subjects = asArray<any>(bibjson?.subject)
    .map(s => s?.term)
    .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);

  const seen = new Set<string>();
  return [...keywords, ...subjects].filter(topic => {
    const key = topic.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const id = raw?.id != null ? String(raw.id) : '';
  if (!id) throw new Error('record has no id');

  const bibjson = raw?.bibjson ?? {};

  const title = typeof bibjson.title === 'string' ? bibjson.title.trim() : '';
  if (!title) throw new Error('record has no title');

  const doi = asArray<any>(bibjson.identifier).find(i => i?.type === 'doi')?.id;
  const links = asArray<DoajLink>(bibjson.link);
  const year = bibjson.year ? Number.parseInt(String(bibjson.year), 10) : undefined;
  const fullText = pickFullText(links);

  // `bibjson.journal.language` is an array of upper-case codes. The old
  // connector hardcoded `'en'` with a comment claiming DOAJ does not supply
  // one.
  const language = asArray<string>(bibjson.journal?.language)[0]?.toLowerCase();

  return {
    id: `doaj:${id}`,
    ...(doi ? { doi: String(doi) } : {}),
    title,
    authors: asArray<any>(bibjson.author)
      .map(a => (typeof a?.name === 'string' ? a.name.trim() : ''))
      .filter(Boolean),
    ...(Number.isFinite(year) ? { year } : {}),
    // No default. The old connector fell back to the literal string
    // 'DOAJ Journal', which is a fabricated venue on any record missing one.
    ...(bibjson.journal?.title ? { venue: String(bibjson.journal.title) } : {}),
    ...(bibjson.journal?.publisher ? { publisher: String(bibjson.journal.publisher) } : {}),
    ...(bibjson.abstract ? { abstract: String(bibjson.abstract) } : {}),
    topics: pickTopics(bibjson),
    ...(language ? { language } : {}),

    // Gold, and this is one of the few places the route is known rather than
    // guessed: DOAJ indexes only journals that are themselves fully open
    // access. That is what the directory is.
    oaStatus: 'gold',
    stage: 'published',
    ...(fullText ? { fullText } : {}),
    landingPage: pickLandingPage(links, doi ? String(doi) : undefined, id),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt,
    ...(raw?.last_updated ? { updatedAt: String(raw.last_updated) } : {})
  };
}

export function normalize(payload: DoajPayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = payload?.results ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((raw: any, index) => {
    const nativeId = raw?.id != null ? String(raw.id) : '';
    const ref: SourceRef = {
      provider: 'doaj',
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
