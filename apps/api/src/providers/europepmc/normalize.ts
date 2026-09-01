import type { Paper, PaperStage, FullText, SourceRef } from '@open-access-explorer/shared';
import { httpUrl } from '@open-access-explorer/shared';
import type { EuropePmcPayload } from './fetch';

/**
 * Raw payload -> Paper[]. Pure, and isolated per record.
 *
 * Isolation matters more than it looks. The old connector mapped the whole page
 * in one expression, so a single record that threw took the other 999 with it
 * and the search recorded Europe PMC as having returned nothing. One bad record
 * should cost one record.
 */

export type NormalizeOptions = {
  /** Stamped onto every SourceRef. Passed in so normalisation stays pure and testable. */
  retrievedAt: string;
  /** Rank of the first record in this page, for paged reads. */
  rankOffset?: number;
  /** Round trip time of the request that produced this payload, if known. */
  latency?: number;
};

export type SkippedRecord = {
  /** Position in the payload, so it can be found again. */
  index: number;
  /** The provider's id, when the record got far enough to have one. */
  nativeId?: string;
  reason: string;
};

export type NormalizeOutcome = {
  papers: Paper[];
  /** Records that could not be read. Reported rather than silently dropped. */
  skipped: SkippedRecord[];
};

/** Europe PMC returns single-element lists as a bare object rather than an array. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type FullTextUrl = { documentStyle?: string; availability?: string; url?: string };

function fullTextUrls(raw: any): FullTextUrl[] {
  return asArray<FullTextUrl>(raw?.fullTextUrlList?.fullTextUrl);
}

/**
 * Prefers a real PDF, then a rendered PDF from the PMC id, then HTML.
 *
 * `verified` is always false: a provider saying a URL is a PDF is not the same
 * as having fetched one, and treating those as equivalent is why CORE
 * advertises reader pages as PDFs.
 */
function pickFullText(raw: any): FullText | undefined {
  const urls = fullTextUrls(raw);

  const pdf = urls.find(u => u.documentStyle === 'pdf' || u.url?.toLowerCase().endsWith('.pdf'));
  const pdfUrl = httpUrl(pdf?.url);
  if (pdfUrl) return { url: pdfUrl, kind: 'pdf', verified: false };

  if (raw?.pmcid) {
    return { url: `https://europepmc.org/articles/${raw.pmcid}?pdf=render`, kind: 'pdf', verified: false };
  }

  const html = urls.find(u => u.documentStyle === 'html');
  const htmlUrl = httpUrl(html?.url);
  if (htmlUrl) return { url: htmlUrl, kind: 'html', verified: false };

  return undefined;
}

/**
 * The HTML page for a human.
 *
 * This is the read that used to throw: the guard against a single-object
 * `fullTextUrl` was applied when picking the PDF and then not reused here, so
 * any record with exactly one full-text URL raised a TypeError — and, with no
 * per-record isolation, took the whole page with it.
 */
function pickLandingPage(raw: any): string | undefined {
  const urls = fullTextUrls(raw);
  const html = httpUrl(urls.find(u => u.documentStyle === 'html')?.url);
  if (html) return html;
  return raw?.doi ? `https://doi.org/${raw.doi}` : undefined;
}

function pickAuthors(raw: any): string[] {
  const listed = asArray<any>(raw?.authorList?.author)
    .map(a => {
      const name = `${a?.firstName ?? ''} ${a?.lastName ?? ''}`.trim();
      return name || (typeof a?.fullName === 'string' ? a.fullName : '');
    })
    .filter(Boolean);

  if (listed.length > 0) return listed;

  // `authorString` is a comma-separated fallback, present even when the
  // structured list is not.
  const fallback = typeof raw?.authorString === 'string' ? raw.authorString : '';
  return fallback.split(',').map((s: string) => s.trim()).filter(Boolean);
}

/**
 * Europe PMC indexes preprint servers under the `PPR` source, so it can say
 * which version this is — but it reports no open-access *route*. That is
 * Unpaywall's vocabulary and Unpaywall's job, so `oaStatus` stays `unknown`
 * until enrichment, and retrievability is carried by `fullText` instead.
 */
function pickStage(raw: any): PaperStage {
  if (raw?.source === 'PPR') return 'preprint';
  return raw?.pubYear || raw?.firstPublicationDate ? 'published' : 'unknown';
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const nativeId = raw?.id != null ? String(raw.id) : '';
  if (!nativeId) throw new Error('record has no id');

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) throw new Error('record has no title');

  const year = raw.pubYear ? Number.parseInt(String(raw.pubYear), 10) : undefined;
  const citationCount = raw.citedByCount !== undefined ? Number(raw.citedByCount) : undefined;

  return {
    id: `europepmc:${nativeId}`,
    ...(raw.doi ? { doi: String(raw.doi) } : {}),
    title,
    authors: pickAuthors(raw),
    ...(Number.isFinite(year) ? { year } : {}),
    // The old connector read `journalTitle`, which Europe PMC does not return.
    // The journal is under `journalInfo.journal.title`, so venue was empty on
    // every record from the highest-yield provider in the fan-out.
    ...(raw.journalInfo?.journal?.title ? { venue: String(raw.journalInfo.journal.title) } : {}),
    ...(raw.abstractText ? { abstract: String(raw.abstractText) } : {}),
    topics: asArray<string>(raw.keywordList?.keyword).filter(Boolean).map(String),
    ...(raw.language ? { language: String(raw.language) } : {}),
    ...(Number.isFinite(citationCount) ? { citationCount } : {}),

    oaStatus: 'unknown',
    stage: pickStage(raw),
    ...(pickFullText(raw) ? { fullText: pickFullText(raw)! } : {}),
    ...(pickLandingPage(raw) ? { landingPage: pickLandingPage(raw)! } : {}),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(
  payload: EuropePmcPayload,
  options: NormalizeOptions
): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const results = payload?.resultList?.result ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  results.forEach((raw: any, index) => {
    const ref: SourceRef = {
      provider: 'europepmc',
      nativeId: raw?.id != null ? String(raw.id) : '',
      // Position in Europe PMC's own result list — provenance, and the input
      // to rank fusion.
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(raw, ref));
    } catch (error) {
      skipped.push({
        index: rankOffset + index,
        ...(ref.nativeId ? { nativeId: ref.nativeId } : {}),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { papers, skipped };
}
