/**
 * Which search implementation serves a request.
 *
 * One config value, read once at boot. The old pipeline stays the default
 * until the comparison across the full query set says the new one is better —
 * "different" is not the same as "better", and the flag exists so that
 * judgement can be made on evidence rather than on the fact that the new code
 * is newer.
 *
 * The flag stays in place for a release after the default flips, so a
 * rollback is a config change rather than a deploy.
 */
export type SearchPath = 'pipeline' | 'orchestrator';

export const DEFAULT_SEARCH_PATH: SearchPath = 'pipeline';

export function resolveSearchPath(value = process.env.SEARCH_PATH): SearchPath {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'orchestrator') return 'orchestrator';
  if (normalized === 'pipeline') return 'pipeline';
  return DEFAULT_SEARCH_PATH;
}
