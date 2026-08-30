import type { AuthorityFacts } from '@open-access-explorer/shared';
import type { OpenCitationsPayload } from './fetch';

/**
 * OpenCitations payload -> AuthorityFacts.
 *
 * **A zero is not a count.** A DOI OpenCitations has never seen answers HTTP
 * 200 with `[{"count": "0"}]` — measured 2026-08-30 against a DOI that does
 * not exist — which is the same body a genuinely uncited paper would produce.
 * The two are indistinguishable from the outside, and they are not equally
 * likely: an uncited paper is common, but so is a paper simply absent from the
 * index, and writing a hard `0` onto the second one puts a false value into
 * the field the citations sort orders on. Nothing is claimed instead, which
 * leaves the paper where an unknown count belongs.
 */
export function normalize(payload: OpenCitationsPayload | null): AuthorityFacts | null {
  const count = Number(payload?.[0]?.count);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { citationCount: count };
}
