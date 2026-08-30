import { describe, it, expect } from 'vitest';
import { DEFAULT_SEARCH_PATH, resolveSearchPath } from '../search-path';

/**
 * The flag decides which implementation serves every search, so the failure
 * that matters is not rejecting a bad value — it is a typo silently selecting
 * a path nobody chose, or taking the endpoint down at boot.
 */
describe('resolveSearchPath', () => {
  it('reads both paths', () => {
    expect(resolveSearchPath('pipeline')).toBe('pipeline');
    expect(resolveSearchPath('orchestrator')).toBe('orchestrator');
  });

  it('is not fussy about case or surrounding whitespace', () => {
    expect(resolveSearchPath('  ORCHESTRATOR ')).toBe('orchestrator');
    expect(resolveSearchPath('Pipeline')).toBe('pipeline');
  });

  it('falls back to the default rather than throwing, for anything else', () => {
    for (const value of ['', '   ', 'orchestra', 'true', '1', undefined]) {
      expect(resolveSearchPath(value)).toBe(DEFAULT_SEARCH_PATH);
    }
  });

  // Flipped in phase 10, on the evidence of the whole-path comparison. This
  // assertion is here so the default cannot move again by accident — it is the
  // one line that decides what every search runs.
  it('defaults to the orchestrator', () => {
    expect(DEFAULT_SEARCH_PATH).toBe('orchestrator');
  });

  // The old path has not gone anywhere. Deleting it is the rest of phase 10,
  // and until then a rollback is this value in the environment, not a deploy.
  it('still selects the old pipeline when asked for it', () => {
    expect(resolveSearchPath('pipeline')).toBe('pipeline');
  });
});
