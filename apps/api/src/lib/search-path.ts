/**
 * Which search implementation serves a request.
 *
 * One config value, read once at boot. The orchestrator is the default as of
 * phase 10, on the evidence of the whole-path comparison recorded in the
 * runbook: 70% of what it returned was shared with the old path, median
 * latency 8,111 ms against 13,149 ms, and DOI, venue, publisher, topics and
 * citation coverage all higher — 93% / 93% / 46% / 94% / 39% against
 * 63% / 61% / 4% / 77% / 21%. "Different" is not "better", and the flag exists
 * so that judgement could be made on evidence rather than on the fact that the
 * new code is newer.
 *
 * The count difference that comparison showed is not a coverage loss:
 * DataCite is skipped on measured evidence, arXiv's is the OR-to-AND fix
 * removing records that were never matches, and OpenAlex's was read depth,
 * since closed by internal pagination.
 *
 * **The old path is still here, and the flag still selects it.** Setting
 * `SEARCH_PATH=pipeline` restores it without a deploy, which is the point of
 * flipping a default rather than deleting the alternative. Phase 10's
 * remaining tasks — deleting the pipeline, the old connectors and
 * `fallback.ts` — wait until this has run as the default for a release.
 */
export type SearchPath = 'pipeline' | 'orchestrator';

export const DEFAULT_SEARCH_PATH: SearchPath = 'orchestrator';

export function resolveSearchPath(value = process.env.SEARCH_PATH): SearchPath {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'orchestrator') return 'orchestrator';
  if (normalized === 'pipeline') return 'pipeline';
  return DEFAULT_SEARCH_PATH;
}
