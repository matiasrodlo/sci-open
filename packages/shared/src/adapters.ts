import type { OARecord } from './types';
import type { LegacyOaStatus, Paper, PaperStage, SourceRef } from './paper';

/**
 * Translation between the new `Paper` and the `OARecord` the API still speaks.
 *
 * This is what lets the orchestrator run behind a flag without the frontend
 * moving: the new path builds `Paper`s and converts on the way out, so the
 * response stays byte-compatible. Both functions disappear once the frontend
 * is on `Paper` — or stay permanently, if a stable external contract turns out
 * to be worth the translation.
 *
 * `toOARecord(fromOARecord(x))` must return `x` unchanged. That is asserted in
 * the tests, and it is the property that makes the flag safe to flip: a
 * difference here would show up as results that shift when the flag moves,
 * which is exactly the signal the phase-07 comparison script exists to trust.
 */

/**
 * The legacy `oaStatus` is a version stage wearing an access-route name, so it
 * maps to `stage` and leaves `oaStatus` (the route) unknown. An `OARecord`
 * carries no route information — that arrives from Unpaywall during
 * enrichment.
 */
const STAGE_FROM_LEGACY: Record<LegacyOaStatus, PaperStage> = {
  preprint: 'preprint',
  accepted: 'accepted',
  published: 'published',
  other: 'unknown'
};

const LEGACY_FROM_STAGE: Record<PaperStage, LegacyOaStatus> = {
  preprint: 'preprint',
  accepted: 'accepted',
  published: 'published',
  unknown: 'other'
};

export function fromOARecord(record: OARecord, rank = 0): Paper {
  const ref: SourceRef = {
    provider: record.source,
    nativeId: record.sourceId,
    rank,
    retrievedAt: record.createdAt,
    ...(record.sourceMetadata?.latency !== undefined
      ? { latency: record.sourceMetadata.latency }
      : {})
  };

  return {
    id: record.id,
    ...(record.doi !== undefined ? { doi: record.doi } : {}),
    title: record.title,
    authors: record.authors,
    ...(record.year !== undefined ? { year: record.year } : {}),
    ...(record.venue !== undefined ? { venue: record.venue } : {}),
    ...(record.publisher !== undefined ? { publisher: record.publisher } : {}),
    ...(record.abstract !== undefined ? { abstract: record.abstract } : {}),
    topics: record.topics ?? [],
    ...(record.language !== undefined ? { language: record.language } : {}),
    ...(record.citationCount !== undefined ? { citationCount: record.citationCount } : {}),

    // A record straight from one provider has no route information and nothing
    // to attribute — every field came from `sources[0]`, which already says so.
    oaStatus: 'unknown',
    stage: record.oaStatus ? STAGE_FROM_LEGACY[record.oaStatus] : 'unknown',
    ...(record.bestPdfUrl !== undefined
      ? { fullText: { url: record.bestPdfUrl, kind: 'pdf' as const, verified: false } }
      : {}),
    ...(record.landingPage !== undefined ? { landingPage: record.landingPage } : {}),

    sources: [ref],
    fieldSources: {},

    retrievedAt: record.createdAt,
    ...(record.updatedAt !== undefined ? { updatedAt: record.updatedAt } : {}),
    ...(compatFor(record) ?? {})
  };
}

/**
 * The leftovers of the old shape that the new model has no place for, plus the
 * two presence facts `stage` and `topics` cannot carry on their own. Omitted
 * entirely when there is nothing to keep, so a paper built from a clean record
 * has no compat baggage at all.
 */
function compatFor(record: OARecord): { compat: NonNullable<Paper['compat']> } | undefined {
  const compat: NonNullable<Paper['compat']> = {};

  if (record.sourceMetadata !== undefined) compat.sourceMetadata = record.sourceMetadata;
  if (record.oaStatus !== undefined) compat.oaStatus = record.oaStatus;
  if (record.topics !== undefined) compat.hadTopics = true;

  return Object.keys(compat).length > 0 ? { compat } : undefined;
}

export function toOARecord(paper: Paper): OARecord {
  const primary = paper.sources[0];
  if (!primary) {
    throw new Error(`Paper ${paper.id} has no sources; cannot express it as an OARecord`);
  }

  // The old shape has one source per record, so a merged paper is reported
  // under the provider that supplied the record it was merged onto. The rest
  // survive only in `sources`, which is the reason to move off this shape.
  return {
    id: paper.id,
    ...(paper.doi !== undefined ? { doi: paper.doi } : {}),
    title: paper.title,
    authors: paper.authors,
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.venue !== undefined ? { venue: paper.venue } : {}),
    ...(paper.publisher !== undefined ? { publisher: paper.publisher } : {}),
    ...(paper.abstract !== undefined ? { abstract: paper.abstract } : {}),
    source: primary.provider,
    sourceId: primary.nativeId,
    ...(legacyStatusOf(paper) !== undefined ? { oaStatus: legacyStatusOf(paper) } : {}),
    ...(paper.fullText !== undefined ? { bestPdfUrl: paper.fullText.url } : {}),
    ...(paper.landingPage !== undefined ? { landingPage: paper.landingPage } : {}),
    ...(paper.topics.length > 0 || paper.compat?.hadTopics ? { topics: paper.topics } : {}),
    ...(paper.language !== undefined ? { language: paper.language } : {}),
    ...(paper.citationCount !== undefined ? { citationCount: paper.citationCount } : {}),
    ...(paper.compat?.sourceMetadata !== undefined
      ? { sourceMetadata: paper.compat.sourceMetadata }
      : {}),
    createdAt: paper.retrievedAt,
    ...(paper.updatedAt !== undefined ? { updatedAt: paper.updatedAt } : {})
  };
}

/**
 * The legacy status a paper should be reported under. Prefers what the source
 * record actually said; falls back to deriving it from `stage` for a paper the
 * orchestrator built rather than converted.
 */
function legacyStatusOf(paper: Paper): LegacyOaStatus | undefined {
  if (paper.compat?.oaStatus !== undefined) return paper.compat.oaStatus;
  return paper.stage === 'unknown' ? undefined : LEGACY_FROM_STAGE[paper.stage];
}
