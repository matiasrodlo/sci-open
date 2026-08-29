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

  // The old path stays the default until the comparison says otherwise. When
  // that flips, this test is the one to change deliberately.
  it('defaults to the old pipeline', () => {
    expect(DEFAULT_SEARCH_PATH).toBe('pipeline');
  });
});
