import { httpUrl, stripMarkup, type Paper, type FullText, type SourceRef } from '@open-access-explorer/shared';

/**
 * CORE payload -> Paper[]. Pure, and isolated per record.
 *
 * CORE aggregates repository deposits, so a record describes a *copy* of a
 * paper held somewhere, and the fields say where. Getting the full text right
 * is most of the work here — see `pickFullText`.
 */

export type CorePayload = { totalHits?: number; results?: unknown[] };
export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

type CoreLink = { type?: string; url?: string };

const isPdf = (url: string) => url.toLowerCase().split('?')[0].endsWith('.pdf');

/**
 * A retrievable copy, and only when it is actually a file.
 *
 * The old connector's first priority was `https://core.ac.uk/reader/{id}` —
 * assigned to `bestPdfUrl` for **every** record that had an id, which is all of
 * them. So the two real PDFs it then looked for were unreachable code, and
 * every CORE record advertised an HTML reader page as its PDF.
 *
 * The order here is: CORE's own hosted PDF, then the repository's own file,
 * then the reader page — as `html`, which is what it is.
 */
export function pickFullText(raw: any): FullText | undefined {
  // Every candidate goes through `httpUrl` first, so one that is not a web
  // address falls through to the next rather than being returned as a copy.
  // `isPdf` is a test on the spelling of a URL and cannot do this itself:
  // `javascript:alert(document.domain)//evil.pdf` ends in `.pdf` and satisfied
  // it exactly as well as a real file did.
  const download = httpUrl(text(raw?.downloadUrl));
  if (download && isPdf(download)) return { url: download, kind: 'pdf', verified: false };

  const fromSource = asArray<string>(raw?.sourceFulltextUrls).map(u => httpUrl(text(u))).find(u => u && isPdf(u));
  if (fromSource) return { url: fromSource, kind: 'pdf', verified: false };

  const fromLinks = asArray<CoreLink>(raw?.links).map(l => httpUrl(l.url)).find(u => u && isPdf(u));
  if (fromLinks) return { url: fromLinks, kind: 'pdf', verified: false };

  // Not a PDF, but still a way to read the paper.
  const reader = httpUrl(asArray<CoreLink>(raw?.links).find(l => l.type === 'reader')?.url);
  if (reader) return { url: reader, kind: 'html', verified: false };

  return undefined;
}

/** The page a human should land on. The reader, where CORE offers one. */
function pickLandingPage(raw: any, doi: string | undefined, id: string): string {
  const links = asArray<CoreLink>(raw?.links);
  const reader = httpUrl(links.find(l => l.type === 'reader')?.url);
  if (reader) return reader;
  const display = httpUrl(links.find(l => l.type === 'display')?.url);
  if (display) return display;
  if (doi) return `https://doi.org/${doi}`;
  return `https://core.ac.uk/works/${id}`;
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const nativeId = ref.nativeId;
  if (!nativeId) throw new Error('record has no id');

  // Repository deposits, which is depositor-written metadata — the same input
  // class as OpenAIRE, which indexes many of the same repositories.
  const title = stripMarkup(raw?.title);
  if (!title) throw new Error('record has no title');

  const doi = text(raw?.doi);
  const year = Number(raw?.yearPublished);
  const citationCount = Number(raw?.citationCount);
  const abstract = stripMarkup(raw?.abstract);
  const fullText = pickFullText(raw);

  // `journals[].title`. The old connector read `publishedVenue.name` and
  // `journal.name`, and CORE has neither field — so its venue was undefined on
  // every record. It is often absent here too, which is a property of a
  // repository aggregator rather than a bug.
  const venue = asArray<any>(raw?.journals).map(j => text(j?.title)).find(Boolean);

  return {
    id: `core:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: asArray<any>(raw?.authors)
      .map(a => text(a?.name) ?? `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.trim())
      .filter(Boolean),
    ...(Number.isFinite(year) && year > 0 ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(text(raw?.publisher) ? { publisher: text(raw.publisher)! } : {}),
    ...(abstract ? { abstract } : {}),
    // Deliberately empty. CORE gives one `fieldOfStudy` string per record and
    // it is not a subject field: across three recorded records it held
    // `info:eu-repo/semantics/article`, `Journal article` and `Chemistry` — a
    // URI, a document type and a topic. Mapping it would put document types
    // and URIs into the topics facet.
    topics: [],
    ...(text(raw?.language?.code) ? { language: text(raw.language.code)! } : {}),
    ...(Number.isFinite(citationCount) ? { citationCount } : {}),

    // CORE indexes open repository deposits, and a deposit is the green route
    // by definition. It reports no finer distinction.
    oaStatus: 'green',
    stage: 'unknown',
    ...(fullText ? { fullText } : {}),
    landingPage: pickLandingPage(raw, doi, nativeId),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: CorePayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = payload?.results ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((raw: any, index) => {
    const nativeId = raw?.id !== undefined && raw?.id !== null ? String(raw.id) : '';
    const ref: SourceRef = {
      provider: 'core',
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

export function totalHits(payload: CorePayload): number | undefined {
  const reported = Number(payload?.totalHits);
  return Number.isFinite(reported) ? reported : undefined;
}
