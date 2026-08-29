import { describe, it, expect } from 'vitest';
import type { OARecord } from '@open-access-explorer/shared';
import { generateCitation, getFileExtension } from '../citations';

function record(over: Partial<OARecord> = {}): OARecord {
  return {
    id: 'europepmc:1',
    doi: '10.1234/example',
    title: 'A study of things',
    authors: ['Lovelace, Ada', 'Babbage, Charles'],
    year: 2020,
    venue: 'Journal of Things',
    publisher: 'Thing Press',
    source: 'europepmc',
    sourceId: '1',
    oaStatus: 'published',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over
  } as OARecord;
}

const bibtex = (r: OARecord) => generateCitation(r, { format: 'bibtex' });

describe('BibTeX escaping', () => {
  it.each([
    ['&', 'R&D methods', '\\&'],
    ['%', '100% coverage', '\\%'],
    ['#', 'C# and other languages', '\\#'],
    ['_', 'snake_case naming', '\\_'],
    ['$', 'Cost in $ terms', '\\$'],
    ['^', 'x^2 growth', '\\textasciicircum{}'],
    ['~', 'approx ~5 percent', '\\textasciitilde{}']
  ])('escapes %s in the title', (_char, title, expected) => {
    expect(bibtex(record({ title }))).toContain(expected);
  });

  /**
   * KNOWN DEFECT — flips to passing when the citation formatters are fixed.
   *
   * The escapes run as a chain of replaces, and the backslash rule runs first:
   * `\` becomes `\textbackslash{}`, and the very next two rules then escape the
   * braces that replacement just introduced. A single backslash comes out as
   * `\textbackslash\{\}`, which is not valid LaTeX for a backslash.
   *
   * Only the backslash is affected — `^` and `~` expand to braces too, but
   * their rules run after the brace escaping rather than before.
   */
  it.fails('escapes a backslash without mangling its own replacement', () => {
    expect(bibtex(record({ title: 'path a\\b' }))).toContain('a\\textbackslash{}b');
  });

  it('shows what the backslash currently produces', () => {
    // Pins the broken output, so the defect above cannot be "fixed" by
    // accident without someone noticing this expectation change too.
    expect(bibtex(record({ title: 'path a\\b' }))).toContain('a\\textbackslash\\{\\}b');
  });
});

describe('generateCitation', () => {
  it('emits a bibtex entry with the core fields', () => {
    const out = bibtex(record());
    expect(out).toMatch(/^@\w+\{/);
    expect(out).toContain('A study of things');
    expect(out).toContain('2020');
    expect(out).toContain('Journal of Things');
  });

  it('produces output for every declared format', () => {
    const formats = ['bibtex', 'endnote', 'ris', 'wos', 'apa', 'mla', 'chicago', 'harvard', 'vancouver', 'plain'] as const;
    for (const format of formats) {
      const out = generateCitation(record(), { format });
      expect(out, `${format} produced nothing`).toBeTruthy();
      expect(out).toContain('A study of things');
    }
  });

  it('does not throw on a record missing everything optional', () => {
    const sparse = { id: 'x:1', title: 'Bare', authors: [], source: 'arxiv', sourceId: '1', createdAt: '2024-01-01T00:00:00.000Z' } as OARecord;
    expect(() => generateCitation(sparse, { format: 'bibtex' })).not.toThrow();
    expect(() => generateCitation(sparse, { format: 'apa' })).not.toThrow();
  });
});

describe('getFileExtension', () => {
  it.each([
    ['bibtex', 'bib'],
    ['ris', 'ris']
  ])('maps %s to .%s', (format, ext) => {
    expect(getFileExtension(format as any)).toBe(ext);
  });
});
