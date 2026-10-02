import { describe, it, expect } from 'vitest';
import type { Paper } from '@open-access-explorer/shared';
import { generateCitation } from '../citations';

/**
 * An RIS value is flattened to one line. It was done with an expression that
 * took 1.1 s on a run of 50,000 spaces, and a value here is a provider's text
 * with no whitespace collapsed on the way.
 */

function record(over: Partial<Paper> = {}): Paper {
  return {
    id: 'europepmc:1',
    title: 'A study of things',
    authors: ['Lovelace, Ada'],
    year: 2020,
    topics: [],
    oaStatus: 'gold',
    stage: 'published',
    sources: [{ provider: 'europepmc', nativeId: '1', rank: 0, retrievedAt: '2024-01-01T00:00:00.000Z' }],
    fieldSources: {},
    retrievedAt: '2024-01-01T00:00:00.000Z',
    ...over
  };
}

const ris = (r: Paper) => generateCitation(r, { format: 'ris', includeAbstract: true });
const line = (out: string, tag: string) => out.split('\r\n').find(l => l.startsWith(`${tag}  - `));

describe('RIS: one line per value', () => {
  it('flattens a long run of whitespace without trying every split of it', () => {
    const started = Date.now();
    const out = ris(record({ abstract: `${' '.repeat(50_000)}tail`, venue: `Journal${' \t'.repeat(25_000)}of Things` }));
    expect(Date.now() - started).toBeLessThan(250);
    expect(line(out, 'AB')).toBe('AB  - tail');
  });

  it('joins the lines of a value with one space, whatever surrounded the breaks', () => {
    const out = ris(record({ abstract: '  First line.  \r\n\n   Second line.\nThird   line.  ' }));
    expect(line(out, 'AB')).toBe('AB  - First line. Second line. Third   line.');
  });

  it('treats a lone carriage return as a line break, which the expression did not', () => {
    const out = ris(record({ abstract: 'Before.\rAfter.' }));
    expect(line(out, 'AB')).toBe('AB  - Before. After.');
    expect(out).not.toMatch(/[^\n]\r[^\n]/);
  });
});
