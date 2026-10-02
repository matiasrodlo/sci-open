import type { Paper, PaperStage, SourceRef } from '@open-access-explorer/shared';
import { fullTextAt, httpUrl, stripMarkup } from '@open-access-explorer/shared';
import type { HalPayload } from './fetch';

/** HAL Solr payload -> Paper[]. Pure, and isolated per record. */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

/**
 * The document types read, and the version each one is.
 *
 * HAL's type is a deposit form rather than a version, but the forms are
 * specific enough to say: an article, a conference paper, a chapter, a book
 * and a report are published work, and `UNDEFINED` is HAL's
 * "pré-publication, document de travail" — its preprint and working-paper
 * subtypes. Measured over the open files on 2026-10-01: 864,956 articles,
 * 289,096 conference papers, 71,846 preprints, 71,759 chapters, 40,232
 * reports, 8,812 books.
 *
 * Every other type is left out, and these are the reasons:
 *
 * - **Theses**: `THESE`, `HDR`, `MEM`, `ETABTHESE`, `MEMLIC` — doctoral and
 *   habilitation theses and student dissertations, 277,268 of the open files.
 *   Left out by decision rather than for a defect: the corpus a reader
 *   searches here is papers.
 * - **Not a paper**: images, video, sound, maps, software, posters, slides,
 *   lecture notes, blog posts, encyclopedia notices, patents, translations,
 *   special issues, and the `REPORT_*` family of student internship reports.
 *
 * Exported because `translate` narrows by it and `fetch` reads by it, so the
 * types asked for and the stage each is given cannot drift apart.
 */
export const STAGES: Record<string, PaperStage> = {
  ART: 'published',
  COMM: 'published',
  COUV: 'published',
  OUV: 'published',
  REPORT: 'published',
  UNDEFINED: 'preprint'
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: unknown): string | undefined {
  const found = asArray(value as unknown).find(v => typeof v === 'string' && v.trim());
  return typeof found === 'string' ? found.trim() : undefined;
}

/**
 * The author's keywords, each once.
 *
 * A deposit carries them in every language its author gave them — `climat`
 * beside `climate` — and both are kept, as a merge keeps two providers'
 * vocabularies: each says something true. Only the repeats go.
 */
function pickTopics(doc: any): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const raw of asArray<unknown>(doc?.keyword_s)) {
    if (typeof raw !== 'string') continue;
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    topics.push(term);
  }
  return topics;
}

function normalizeOne(doc: any, ref: SourceRef): Paper {
  const nativeId = ref.nativeId;
  if (!nativeId) throw new Error('record has no halId');

  /**
   * The first title, and the first abstract with it.
   *
   * A deposit can carry both in several languages — 33 of 40 records sampled
   * had two titles, `["Climat", "Climate"]` — and the first is the one in the
   * language of the document, the form OpenAIRE and CORE carry when they index
   * the same deposit. A record without a DOI is merged on its title, so taking
   * the translation would keep it apart from theirs.
   */
  const title = stripMarkup(first(doc.title_s));
  if (!title) throw new Error('record has no title');

  const stage = STAGES[String(doc.docType_s ?? '')];
  if (!stage) throw new Error(`document type ${String(doc.docType_s)} is not read`);

  const doi = first(doc.doiId_s);
  const year = Number(doc.producedDateY_i);
  const abstract = stripMarkup(first(doc.abstract_s));
  const venue = first(doc.journalTitle_s) ?? first(doc.conferenceTitle_s) ?? first(doc.bookTitle_s);
  const publisher = first(doc.journalPublisher_s) ?? first(doc.publisher_s);
  const language = first(doc.language_s);
  const landingPage = httpUrl(doc.uri_s);

  /**
   * HAL's main file, which it serves itself — but only when it is open.
   *
   * A file under embargo keeps its `fileMain_s` and answers HTTP 403, measured
   * on two of them. `fetch.ts` reads only open files, so this test is not what
   * keeps those out; it is what keeps a record that arrived some other way
   * from claiming a copy nobody can read.
   *
   * A PDF: HAL wants one as the main file, and all 2,000 of the most recent
   * open deposits read had one. `/document` names no extension and answers
   * `application/pdf`.
   */
  const fullText = doc.openAccess_bool === true ? fullTextAt(doc.fileMain_s, 'pdf') : undefined;

  return {
    id: `hal:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: asArray<unknown>(doc.authFullName_s).filter((a): a is string => typeof a === 'string' && !!a.trim()),
    ...(Number.isInteger(year) && year > 0 ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(publisher ? { publisher } : {}),
    ...(abstract ? { abstract } : {}),
    topics: pickTopics(doc),
    ...(language ? { language } : {}),

    // A deposit in an open archive is the green route by definition, as it is
    // for CORE. A publisher copy of the same work may be gold; where another
    // provider says so, the merge prefers it.
    oaStatus: 'green',
    stage,
    ...(fullText ? { fullText } : {}),
    ...(landingPage ? { landingPage } : {}),

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: HalPayload, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const docs = payload?.response?.docs ?? [];

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  docs.forEach((doc: any, index) => {
    const nativeId = typeof doc?.halId_s === 'string' ? doc.halId_s.trim() : '';
    const ref: SourceRef = {
      provider: 'hal',
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

/** HAL's own count for this query. */
export function totalHits(payload: HalPayload): number | undefined {
  const reported = Number(payload?.response?.numFound);
  return Number.isFinite(reported) ? reported : undefined;
}
