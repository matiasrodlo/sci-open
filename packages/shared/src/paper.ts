import type { OASource } from './types';
import type { AuthorityId } from './authority';

/**
 * A work, as the orchestrator holds it after merging what every provider said
 * about it.
 *
 * The premise is `sources`: a paper is not "the record OpenAlex gave us", it is
 * one work that several providers described, with the merge choosing a value
 * per field and recording who supplied it.
 */

/**
 * A source that returns *records* — the ten the fan-out asks, and the only ones
 * that can appear in `SourceRef`.
 *
 * Narrower than `OASource` on purpose. That union holds fourteen names, and
 * three of them — Crossref, Unpaywall, OpenCitations — are authorities: they
 * answer per-DOI questions about a paper somebody else returned, and never
 * return one themselves. (OpenAlex is both, and is the reason the two sets
 * overlap rather than partition.)
 *
 * Aliasing the two made the distinction unstateable, and it showed up as three
 * rows in `merge.ts`'s `PROVIDER_PRIORITY` that could never be consulted:
 * `priorityOf` reads `paper.sources`, nothing ever appends an authority to
 * `sources`, and the ranks sat there looking like trust decisions about
 * Crossref and Unpaywall that the merge would honour. It could not honour them.
 * They existed because `Record<ProviderId, number>` demanded every key of a
 * union that had three names too many in it.
 */
export type ProviderId = Exclude<OASource, 'crossref' | 'unpaywall' | 'opencitations'>;

/**
 * One provider's sighting of this paper.
 *
 * `rank` is load-bearing twice over: it is provenance, and it is the input to
 * rank fusion. Fusing positions rather than scores is what keeps providers
 * comparable — their relevance scores are computed differently and on different
 * corpora, so pooling them directly is meaningless.
 */
export type SourceRef = {
  provider: ProviderId;
  /** The provider's own identifier, not ours. */
  nativeId: string;
  /** Zero-based position in that provider's own result list for this query. */
  rank: number;
  retrievedAt: string;
  /** Round trip time for the request that produced it, when known. */
  latency?: number;
};

/**
 * Open-access route, in Unpaywall's graded vocabulary.
 *
 * Deliberately not a boolean, and deliberately not the same field as
 * `fullText`. "Is this legally open?" and "can I actually fetch the file?" are
 * different questions, and answering them with one value is why CORE currently
 * advertises HTML reader pages as PDFs.
 */
export type OaRoute = 'gold' | 'green' | 'hybrid' | 'bronze' | 'closed' | 'unknown';

/**
 * Which version of the work this is.
 *
 * Separate from `oaStatus` because they are different axes: stage is about the
 * version, route is about how it is made available. The `OARecord` field these
 * replace conflated the two, which is why it holds `preprint` and `published`
 * in the same slot Unpaywall would use for `gold`.
 */
export type PaperStage = 'preprint' | 'accepted' | 'published' | 'unknown';

export type FullTextKind = 'pdf' | 'html' | 'xml';

/** A retrievable copy. `verified` means we actually confirmed it, not that a provider claimed it. */
export type FullText = {
  url: string;
  kind: FullTextKind;
  verified: boolean;
};

/** The fields a merge picks between, and therefore the ones worth attributing. */
export type ProvenancedField =
  | 'title' | 'abstract' | 'authors' | 'year' | 'venue' | 'publisher'
  | 'topics' | 'language' | 'citationCount' | 'oaStatus' | 'fullText' | 'landingPage';

/**
 * Which provider supplied each field of the merged record.
 *
 * A sidecar rather than wrapping every field in `{ value, source }`: the
 * wrapper is viral, turning `paper.title` into `paper.title.value` for every
 * consumer, export template and citation formatter, to serve a need only the
 * merge layer and a provenance display actually have.
 *
 * Only populated where it is informative — a paper assembled from one provider
 * has nothing to attribute that `sources` does not already say.
 */
export type FieldSources = Partial<Record<ProvenancedField, FieldSource>>;

/**
 * Who supplied one field: a provider that returned the record, or an authority
 * that answered about it afterwards.
 *
 * This is the union `FieldSources` always needed and could not say while
 * `ProviderId` was every source there is. `applyFacts` writes an authority id
 * here — that is its whole job — so the type had to admit them, and admitting
 * them by making *every* source a provider is what put unreachable rows in the
 * merge's trust order.
 */
export type FieldSource = ProviderId | AuthorityId;

/**
 * Reserved. Distinct DOIs are distinct papers today, which is what the data
 * supports: in a 1,500-record sample exactly one group looked like a genuine
 * preprint/published pair, against 83 duplicates caused by PubMed records
 * arriving without a DOI at all.
 *
 * The field exists so that treating them as one paper later is an additive
 * change rather than a rewrite of `id` generation, which everything keys on.
 */
export type Paper = {
  id: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  publisher?: string;
  abstract?: string;
  topics: string[];
  language?: string;
  citationCount?: number;

  /** How it is open. See `OaRoute`. */
  oaStatus: OaRoute;
  /** Which version this is. See `PaperStage`. */
  stage: PaperStage;
  /** A copy we can actually serve, when there is one. */
  fullText?: FullText;
  landingPage?: string;

  /** Every provider that returned this work, in the order they were merged. */
  sources: SourceRef[];
  /** Who supplied each merged field. Empty when there was nothing to choose between. */
  fieldSources: FieldSources;
  retrievedAt: string;
  updatedAt?: string;
};
