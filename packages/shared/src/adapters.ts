import type { OARecord } from './types';
import type { Paper, PaperStage } from './paper';

/**
 * `Paper` -> the `OARecord` the API still speaks.
 *
 * The orchestrator builds `Paper`s and converts on the way out, so the response
 * shape holds steady no matter what the pipeline behind it knows. That is
 * permanent by decision: the frontend consumes `OARecord`, and a stable
 * external contract turned out to be worth the translation. Moving the frontend
 * onto `Paper` is a response-shape change and its own piece of work.
 *
 * **The reverse direction is gone.** `fromOARecord` rebuilt a `Paper` from an
 * `OARecord` and parked whatever the new model had no place for in a
 * `Paper.compat` bag, so that `toOARecord(fromOARecord(x))` returned `x`
 * unchanged. That property was what the phase-07 flag rested on, when a record
 * could enter the pipeline already in the old shape. Since phase 13 every
 * `Paper` is built by a provider normaliser, so nothing called `fromOARecord`
 * outside its own round-trip test — which meant `compat` was never populated in
 * a running service, and three fields on `Paper` plus half the branches in this
 * file could not be reached. Both are deleted rather than left as a path the
 * tests were the only traffic on.
 *
 * One consequence is worth naming rather than discovering: `sourceMetadata` now
 * has no producer. It survived only in the compat bag, so no response has
 * actually carried it since the old path went. The field stays on `OARecord`
 * because removing it is a change to the published contract, not to this file.
 */

/** The `oaStatus` vocabulary of the shape this converts to. */
export type LegacyOaStatus = NonNullable<OARecord['oaStatus']>;

/**
 * `stage` is which version a work is; `OARecord.oaStatus` is that same question
 * wearing an access-route name, which is why the two map directly.
 *
 * `unknown` is deliberately absent. It has no spelling here that does not also
 * mean something else — `other` is a positive claim about a record rather than
 * an admission of not knowing — so it is reported by leaving the optional field
 * off. See `legacyStatusOf`.
 */
const LEGACY_FROM_STAGE: Record<Exclude<PaperStage, 'unknown'>, LegacyOaStatus> = {
  preprint: 'preprint',
  accepted: 'accepted',
  published: 'published'
};

export function toOARecord(paper: Paper): OARecord {
  const primary = paper.sources[0];
  if (!primary) {
    throw new Error(`Paper ${paper.id} has no sources; cannot express it as an OARecord`);
  }

  const oaStatus = legacyStatusOf(paper);

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
    ...(oaStatus !== undefined ? { oaStatus } : {}),
    ...(paper.fullText !== undefined ? { bestPdfUrl: paper.fullText.url } : {}),
    ...(paper.landingPage !== undefined ? { landingPage: paper.landingPage } : {}),
    ...(paper.topics.length > 0 ? { topics: paper.topics } : {}),
    ...(paper.language !== undefined ? { language: paper.language } : {}),
    ...(paper.citationCount !== undefined ? { citationCount: paper.citationCount } : {}),
    createdAt: paper.retrievedAt,
    ...(paper.updatedAt !== undefined ? { updatedAt: paper.updatedAt } : {})
  };
}

/** The legacy status a paper is reported under, or nothing. */
function legacyStatusOf(paper: Paper): LegacyOaStatus | undefined {
  return paper.stage === 'unknown' ? undefined : LEGACY_FROM_STAGE[paper.stage];
}
