import type { Paper, PaperStage, ProvenancedField, ProviderId } from './paper';

/**
 * The second provider role: `lookup(doi) -> facts about a work we already have`.
 *
 * A search provider answers "which works match this query"; an authority
 * answers "what is true of this work". They are separate interfaces because
 * they are asked different questions at different points in the pipeline — the
 * search providers are fanned out to before anything is known, the authorities
 * are consulted about the twenty records that survived ranking and pagination.
 * OpenAlex implements both, which is exactly why the two roles need to be
 * expressible apart from each other.
 */

/**
 * What an authority is able to say about a work.
 *
 * Keyed on `ProvenancedField` rather than on `Paper` so that every field an
 * authority can contribute is, by construction, a field `fieldSources` can
 * attribute. `stage` is the one addition: it is a fact about the work
 * (Unpaywall reports the version its best copy is) with no slot in
 * `FieldSources`, so it is applied without attribution.
 */
export type AuthorityFacts = Partial<Pick<Paper, ProvenancedField>> & {
  stage?: PaperStage;
};

/**
 * What an authority contributes, and where it outranks what we already have.
 *
 * The distinction between the two lists is the whole design. Filling a gap is
 * safe: a paper with no publisher is strictly better off with Crossref's.
 * Replacing a value several providers already agreed on is not, and is only
 * justified where the authority is definitionally right — Unpaywall does not
 * have an opinion about the open-access route, it *is* the vocabulary the
 * route is expressed in.
 */
export type AuthorityCapabilities = {
  /** Fields this authority populates when they are missing. */
  fields: readonly ProvenancedField[];
  /** Fields whose value replaces one already present. A strict subset of `fields`. */
  authoritative: readonly ProvenancedField[];
};

export type AuthorityStatus = 'ok' | 'timeout' | 'error' | 'skipped';

/**
 * What happened when one authority was consulted about a page.
 *
 * The sibling of `ProviderReport`, and it counts three things rather than one
 * because "we asked" and "it answered" and "it told us something we did not
 * already know" are all different, and only the third is worth the request.
 */
export type AuthorityReport = {
  authority: ProviderId;
  status: AuthorityStatus;
  /** DOIs this authority was asked about. */
  asked: number;
  /** Of those, how many came back with a record. */
  answered: number;
  /** Fields actually written onto a paper. Zero means the requests bought nothing. */
  applied: number;
  /** Present when `status` is `error` or `timeout`. */
  error?: string;
  /** Why it was not consulted. Present when `status` is `skipped`. */
  skipReason?: string;
  latency: number;
};

/** Which provider ids name an authority rather than a search provider. */
export type AuthorityId = Extract<ProviderId, 'crossref' | 'unpaywall' | 'openalex' | 'opencitations'>;
