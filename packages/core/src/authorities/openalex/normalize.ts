import type { AuthorityFacts } from '@open-access-explorer/shared';
import { normalize as normalizeWorks } from '../../providers/openalex/normalize';
import type { OpenAlexPayload } from './fetch';

/**
 * OpenAlex payload -> AuthorityFacts.
 *
 * Built by running the search provider's own normaliser and keeping the fields
 * an authority is allowed to contribute. Writing a second normaliser would
 * mean two places to fix when OpenAlex changes a field name, and the search
 * side's is the one with the fixture and the tests behind it — including the
 * three corrections phase 08 made there: the publisher is
 * `host_organization_name`, the route is `open_access.oa_status` rather than a
 * stage, and the landing page is the DOI when there is one.
 *
 * `id`, `sources` and `retrievedAt` are dropped rather than carried: an
 * authority is not a sighting. See `enrich.ts` for why authorities do not join
 * `Paper.sources`.
 */
export function normalize(payload: OpenAlexPayload | null): AuthorityFacts | null {
  if (!payload) return null;

  // `retrievedAt` is required by the normaliser and thrown away here; the
  // enricher records nothing per-authority beyond `fieldSources`.
  const { papers } = normalizeWorks(payload, { retrievedAt: new Date(0).toISOString() });
  const paper = papers[0];
  if (!paper) return null;

  return {
    ...(paper.title ? { title: paper.title } : {}),
    ...(paper.abstract !== undefined ? { abstract: paper.abstract } : {}),
    ...(paper.authors.length > 0 ? { authors: paper.authors } : {}),
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.venue !== undefined ? { venue: paper.venue } : {}),
    ...(paper.publisher !== undefined ? { publisher: paper.publisher } : {}),
    ...(paper.topics.length > 0 ? { topics: paper.topics } : {}),
    ...(paper.language !== undefined ? { language: paper.language } : {}),
    ...(paper.citationCount !== undefined ? { citationCount: paper.citationCount } : {}),
    ...(paper.oaStatus !== 'unknown' ? { oaStatus: paper.oaStatus } : {}),
    ...(paper.fullText !== undefined ? { fullText: paper.fullText } : {}),
    ...(paper.landingPage !== undefined ? { landingPage: paper.landingPage } : {}),
    ...(paper.stage !== 'unknown' ? { stage: paper.stage } : {})
  };
}
