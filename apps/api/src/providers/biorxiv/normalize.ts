import type { Paper, SourceRef } from '@open-access-explorer/shared';
import type { BiorxivServer, ServerCollection } from './fetch';

/** bioRxiv/medRxiv records -> Paper[]. Pure, and isolated per record. */

export type NormalizeOptions = { retrievedAt: string; rankOffset?: number; latency?: number };
export type SkippedRecord = { index: number; nativeId?: string; reason: string };
export type NormalizeOutcome = { papers: Paper[]; skipped: SkippedRecord[] };

/**
 * The API writes the string `"NA"` where a value is absent, so an ordinary
 * truthiness check treats it as present. The old connector's
 * `updatedAt: result.published || result.date` therefore set `updatedAt` to
 * the literal `"NA"` on every unpublished preprint — which is all of them in
 * the recorded window.
 */
function present(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'NA') return undefined;
  return trimmed;
}

const VENUES: Record<BiorxivServer, string> = { biorxiv: 'bioRxiv', medrxiv: 'medRxiv' };

function normalizeOne(raw: any, server: BiorxivServer, ref: SourceRef): Paper {
  const doi = present(raw?.doi);
  if (!doi) throw new Error('record has no doi');

  const title = present(raw?.title);
  if (!title) throw new Error('record has no title');

  const date = present(raw?.date);
  const year = date ? new Date(date).getFullYear() : undefined;
  const version = present(raw?.version) ?? '1';

  // The DOI of the published version, when the preprint has been published.
  // Not used as this record's `doi` — that stays the preprint's, which is what
  // this record is — but it is the reason `published` is read at all.
  const publishedDoi = present(raw?.published);

  return {
    id: `${server}:${doi}`,
    doi,
    title,
    // "LastName1, FirstName1; LastName2, FirstName2"
    authors: (present(raw?.authors) ?? '')
      .split(';')
      .map((a: string) => a.trim())
      .filter(Boolean),
    ...(Number.isFinite(year) ? { year } : {}),
    venue: VENUES[server],
    ...(present(raw?.abstract) ? { abstract: present(raw.abstract)! } : {}),
    topics: present(raw?.category) ? [present(raw.category)!] : [],
    language: 'en',

    // A preprint server is a repository, which is what green means. Unlike the
    // providers that leave this unknown, there is nothing to find out here.
    oaStatus: 'green',
    stage: 'preprint',
    fullText: {
      url: `https://www.${server}.org/content/${doi}v${version}.full.pdf`,
      kind: 'pdf',
      verified: false
    },
    landingPage: `https://www.${server}.org/content/${doi}v${version}`,

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt,
    ...(publishedDoi ? { updatedAt: ref.retrievedAt } : {})
  };
}

/**
 * The highest-numbered version of each DOI.
 *
 * A details lookup returns every version of a preprint — three, for the
 * recorded record — and they are one work, not three. Merge would collapse
 * them by DOI anyway, but a provider that reports a work three times has
 * already misreported what it retrieved, and `rank` would be spent on
 * duplicates.
 */
function latestVersions(collection: any[]): any[] {
  const best = new Map<string, any>();

  for (const raw of collection) {
    const doi = typeof raw?.doi === 'string' ? raw.doi : '';
    if (!doi) {
      // Kept so it can be reported as a skip rather than vanishing here.
      best.set(`__no-doi-${best.size}`, raw);
      continue;
    }
    const version = Number.parseInt(present(raw?.version) ?? '1', 10) || 1;
    const held = best.get(doi);
    const heldVersion = held ? Number.parseInt(present(held?.version) ?? '1', 10) || 1 : -1;
    if (version >= heldVersion) best.set(doi, raw);
  }

  return [...best.values()];
}

export function normalize(
  collections: readonly ServerCollection[],
  options: NormalizeOptions
): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];
  let index = 0;

  for (const { server, collection } of collections) {
    for (const raw of latestVersions(collection as any[])) {
      const nativeId = typeof raw?.doi === 'string' ? raw.doi : '';
      const ref: SourceRef = {
        provider: server,
        nativeId,
        rank: rankOffset + index,
        retrievedAt,
        ...(latency !== undefined ? { latency } : {})
      };

      try {
        papers.push(normalizeOne(raw, server, ref));
      } catch (error) {
        skipped.push({
          index: rankOffset + index,
          ...(nativeId ? { nativeId } : {}),
          reason: error instanceof Error ? error.message : String(error)
        });
      }
      index += 1;
    }
  }

  return { papers, skipped };
}
