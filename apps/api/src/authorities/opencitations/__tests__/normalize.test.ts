import { describe, it, expect } from 'vitest';
import { normalize } from '../index';
import counted from '../__fixtures__/counted.json';
import closedWork from '../__fixtures__/closed-work.json';
import unknown from '../__fixtures__/unknown.json';

describe('opencitations normalize', () => {
  it('reads the count, which arrives as a string', () => {
    expect(normalize(counted as any)).toEqual({ citationCount: 43 });
    expect(normalize(closedWork as any)).toEqual({ citationCount: 162 });
  });

  it('treats a zero as no answer rather than as a count of zero', () => {
    // Measured against a DOI that does not exist: HTTP 200, [{"count": "0"}].
    // Identical to what a genuinely uncited paper produces, so a hard 0 would
    // put a value we cannot stand behind into the field the citations sort
    // orders on.
    expect(unknown).toEqual([{ count: '0' }]);
    expect(normalize(unknown as any)).toBeNull();
  });

  it('says nothing when the body is not the shape it expects', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize([] as any)).toBeNull();
    expect(normalize([{}] as any)).toBeNull();
  });
});
