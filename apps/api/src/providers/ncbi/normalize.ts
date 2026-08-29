import type { Paper, FullText, SourceRef } from '@open-access-explorer/shared';

/**
 * Parsed PubMed XML -> Paper[]. Pure, and isolated per record.
 *
 * The old normaliser was 170 lines of `?.[0] || ` ladders, repeated per field
 * because xml2js wraps every element in an array and renders an element with
 * attributes as `{ _: text, $: attrs }`. Three helpers below collapse all of
 * them, which is what makes the actual field mapping readable — and it is the
 * field mapping, not the unwrapping, that had the defects in it.
 *
 * Kept on xml2js's default `explicitArray: true` rather than switching it off,
 * as the runbook suggested considering. The parity test needs the old
 * normaliser and this one to run against the *same* parsed fixture, and
 * `explicitArray: false` is ambiguous in its own way — a repeated element is
 * still an array, so the unwrapping helper is needed regardless.
 */

export type NormalizeOptions = {
  retrievedAt: string;
  rankOffset?: number;
  latency?: number;
};

export type SkippedRecord = {
  index: number;
  nativeId?: string;
  reason: string;
};

export type NormalizeOutcome = {
  papers: Paper[];
  skipped: SkippedRecord[];
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The single child element named `key`, unwrapped from xml2js's array. */
function one(node: any, key: string): any {
  return asArray(node?.[key])[0];
}

/**
 * The text of `node[key]`.
 *
 * Returns undefined rather than stringifying an object. The old normaliser
 * called `String(...)` on whatever it found and then had to guard against the
 * literal strings `'[object Object]'`, `'undefined'` and `'null'` reaching the
 * title of a search result.
 */
function text(node: any, key: string): string | undefined {
  const value = asArray(node?.[key])[0];
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && typeof value._ === 'string') {
    return value._.trim() || undefined;
  }
  return undefined;
}

/** Text of an element that is itself the node, e.g. an entry in a list. */
function textOf(value: any): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && typeof value._ === 'string') {
    return value._.trim() || undefined;
  }
  return undefined;
}

/**
 * The DOI, which the old connector never read.
 *
 * It walked `ArticleIdList` looking only for the PMC id and broke out of the
 * loop on finding it — stepping straight past the DOI sitting in the same
 * list. The consequence was measured: 83 of 84 surviving duplicates in a
 * 1,500-record sample were a PubMed record with no DOI beside the same paper
 * from Europe PMC with one. A record without a DOI is never grouped with one
 * that has it, so every PubMed record was its own paper.
 *
 * `ELocationID` carries the same value and is the fallback, because it is
 * present on records that predate the `ArticleIdList` entry.
 */
function pickDoi(article: any, pubmedData: any): string | undefined {
  const ids = asArray(one(pubmedData, 'ArticleIdList')?.ArticleId);
  const fromIdList = ids.find((id: any) => id?.$?.IdType === 'doi');
  if (textOf(fromIdList)) return textOf(fromIdList);

  const locations = asArray(article?.ELocationID);
  const fromLocation = locations.find((l: any) => l?.$?.EIdType === 'doi');
  return textOf(fromLocation);
}

function pickPmcId(pubmedData: any): string | undefined {
  const ids = asArray(one(pubmedData, 'ArticleIdList')?.ArticleId);
  const raw = textOf(ids.find((id: any) => id?.$?.IdType === 'pmc'));
  if (!raw) return undefined;
  return raw.startsWith('PMC') ? raw : `PMC${raw}`;
}

/**
 * MeSH descriptors, then the author's own keywords.
 *
 * The old connector wrote `topics: []` on every record. MeSH alone is not
 * enough: PubMed only assigns it once an article has been indexed, and none of
 * the three articles in the recorded fixture carry any — while all three carry
 * a `KeywordList`. Taking both is what gives recent records topics at all.
 */
function pickTopics(medlineCitation: any): string[] {
  const mesh = asArray(one(medlineCitation, 'MeshHeadingList')?.MeshHeading)
    .map((heading: any) => text(heading, 'DescriptorName'))
    .filter((t): t is string => Boolean(t));

  const keywords = asArray(medlineCitation?.KeywordList)
    .flatMap((list: any) => asArray(list?.Keyword))
    .map(textOf)
    .filter((t): t is string => Boolean(t));

  const seen = new Set<string>();
  return [...mesh, ...keywords].filter(topic => {
    const key = topic.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickAuthors(article: any): string[] {
  return asArray(one(article, 'AuthorList')?.Author)
    .map((author: any) => {
      const collective = text(author, 'CollectiveName');
      if (collective) return collective;
      const last = text(author, 'LastName') ?? '';
      const fore = text(author, 'ForeName') ?? text(author, 'Initials') ?? '';
      return `${last} ${fore}`.trim();
    })
    .filter(Boolean);
}

/**
 * The publication year.
 *
 * `PubDate` is either a `Year` or a `MedlineDate` holding a string such as
 * "2026 Jan-Feb" or "1998-1999", which has no Year element at all. The
 * electronic `ArticleDate` is the last resort.
 */
function pickYear(article: any): number | undefined {
  const pubDate = one(one(one(article, 'Journal'), 'JournalIssue'), 'PubDate');

  const year = Number.parseInt(text(pubDate, 'Year') ?? '', 10);
  if (Number.isFinite(year)) return year;

  const medline = text(pubDate, 'MedlineDate');
  const fromMedline = Number.parseInt(medline?.match(/\d{4}/)?.[0] ?? '', 10);
  if (Number.isFinite(fromMedline)) return fromMedline;

  const electronic = Number.parseInt(text(one(article, 'ArticleDate'), 'Year') ?? '', 10);
  return Number.isFinite(electronic) ? electronic : undefined;
}

/** Labelled abstracts arrive as several AbstractText elements. */
function pickAbstract(article: any): string | undefined {
  const parts = asArray(one(article, 'Abstract')?.AbstractText)
    .map(textOf)
    .filter((t): t is string => Boolean(t));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function pickFullText(pmcId: string | undefined): FullText | undefined {
  if (!pmcId) return undefined;
  return {
    url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/pdf/`,
    kind: 'pdf',
    verified: false
  };
}

function normalizeOne(raw: any, ref: SourceRef): Paper {
  const medlineCitation = one(raw, 'MedlineCitation');
  const article = one(medlineCitation, 'Article');
  const pubmedData = one(raw, 'PubmedData');

  const pmid = text(medlineCitation, 'PMID');
  if (!pmid) throw new Error('record has no PMID');

  const title = text(article, 'ArticleTitle');
  if (!title) throw new Error('record has no title');

  const pmcId = pickPmcId(pubmedData);
  const doi = pickDoi(article, pubmedData);
  const venue = text(one(article, 'Journal'), 'Title');
  const year = pickYear(article);
  const abstract = pickAbstract(article);
  const fullText = pickFullText(pmcId);

  return {
    id: `ncbi:${pmid}`,
    ...(doi ? { doi } : {}),
    title,
    authors: pickAuthors(article),
    ...(year !== undefined ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(abstract ? { abstract } : {}),
    topics: pickTopics(medlineCitation),
    language: text(article, 'Language') ?? 'en',

    // The route is Unpaywall's to supply. What is known here is whether PMC
    // holds a copy, which `fullText` carries.
    oaStatus: 'unknown',
    // A PMC copy is the published version. Without one, PubMed says nothing
    // about which version this is, so the stage is unknown rather than guessed.
    stage: pmcId ? 'published' : 'unknown',
    ...(fullText ? { fullText } : {}),
    landingPage: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(articles: readonly unknown[], options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  articles.forEach((raw: any, index) => {
    const nativeId = text(one(raw, 'MedlineCitation'), 'PMID') ?? '';
    const ref: SourceRef = {
      provider: 'ncbi',
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
