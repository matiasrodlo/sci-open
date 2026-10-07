import { describe, it, expect } from 'vitest';
import type { Paper } from '../paper';
import {
  generateCitation, generateCitationsBatch, getFileExtension, bareDoi, escapeBibTeX, citeKey, verbatimBibTeX
} from '../citations';

function record(over: Partial<Paper> = {}): Paper {
  return {
    id: 'europepmc:1',
    doi: '10.1234/example',
    title: 'A study of things',
    authors: ['Lovelace, Ada', 'Babbage, Charles'],
    year: 2020,
    venue: 'Journal of Things',
    publisher: 'Thing Press',
    topics: [],
    oaStatus: 'gold',
    stage: 'published',
    sources: [{ provider: 'europepmc', nativeId: '1', rank: 0, retrievedAt: '2024-01-01T00:00:00.000Z' }],
    fieldSources: {},
    ...over
  };
}

const bibtex = (r: Paper) => generateCitation(r, { format: 'bibtex' });
const ris = (r: Paper) => generateCitation(r, { format: 'ris' });

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
   * Phase 01 recorded this as failing, marked "flips to passing when the
   * citation formatters are fixed". It flips.
   *
   * The escapes were a chain of ten replaces with the backslash rule first:
   * `\` became `\textbackslash{}` and the next two rules escaped the braces
   * that replacement had just introduced, producing `\textbackslash\{\}`. One
   * regex pass cannot revisit its own output, so the ordering question no
   * longer exists.
   */
  it('escapes a backslash without mangling its own replacement', () => {
    expect(bibtex(record({ title: 'path a\\b' }))).toContain('a\\textbackslash{}b');
  });

  it('writes a brace with no partner so the field stays balanced', () => {
    // bibtex and biber count `\{` as a brace: a stray one ended the field
    // early and made the rest of the entry a syntax error.
    expect(escapeBibTeX('a } b')).toBe('a \\textbraceright{} b');
    expect(escapeBibTeX('set {x, y')).toBe('set \\textbraceleft{}x, y');
    expect(escapeBibTeX('} {a} {')).toBe('\\textbraceright{} \\{a\\} \\textbraceleft{}');

    const field = bibtex(record({ abstract: 'Unbalanced { brace and } another } one.' })).match(/^ {2}abstract = \{(.*)\}$/m)![1]!;
    let depth = 0;
    for (const char of field) {
      depth += char === '{' ? 1 : char === '}' ? -1 : 0;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('escapes braces that were in the input', () => {
    expect(escapeBibTeX('a{b}c')).toBe('a\\{b\\}c');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeBibTeX('CRISPR gene editing')).toBe('CRISPR gene editing');
  });
});

describe('DOIs', () => {
  it.each([
    ['10.1234/example'],
    ['https://doi.org/10.1234/example'],
    ['http://dx.doi.org/10.1234/example'],
    ['doi:10.1234/example']
  ])('reduces %s to the bare identifier', input => {
    expect(bareDoi(input)).toBe('10.1234/example');
  });

  it('puts a bare DOI in the bibtex doi field, not a URL', () => {
    // The old formatters emitted the URL form into `doi`, and APA and Chicago
    // then prefixed `https://doi.org/` onto a value that already had it.
    expect(bibtex(record({ doi: 'https://doi.org/10.1234/example' })))
      .toContain('doi = {10.1234/example}');
  });

  it('puts a bare DOI in the RIS DO tag', () => {
    expect(ris(record())).toContain('DO  - 10.1234/example');
  });

  it('writes the doi and url as they are, which biblatex reads verbatim', () => {
    // Escaped as LaTeX, `%20` became `\%20` and `_` became `\_` inside the
    // address, and the bibliography's links were broken.
    const copy = { url: 'https://example.org/my_paper%20v2.pdf', kind: 'pdf' as const, verified: false };
    const out = bibtex(record({ doi: '10.1234/abc_def#1', landingPage: undefined, fullText: copy }));
    expect(out).toContain('doi = {10.1234/abc_def#1}');
    expect(out).toContain('url = {https://doi.org/10.1234/abc_def#1}');

    const noDoi = bibtex(record({ doi: undefined, landingPage: undefined, fullText: copy }));
    expect(noDoi).toContain('url = {https://example.org/my_paper%20v2.pdf}');
  });

  it('percent-encodes only what would unbalance the entry in a verbatim field', () => {
    expect(verbatimBibTeX('https://x.org/a{b}\\c')).toBe('https://x.org/a%7Bb%7D%5Cc');
  });

  it('still offers the resolver as the url', () => {
    expect(bibtex(record())).toContain('url = {https://doi.org/10.1234/example}');
  });

  it('offers the landing page without a DOI, and the copy without either', () => {
    const copy = { url: 'https://example.org/p.pdf', kind: 'pdf' as const, verified: false };
    expect(bibtex(record({ doi: undefined, landingPage: 'https://example.org/p', fullText: copy })))
      .toContain('url = {https://example.org/p}');
    expect(bibtex(record({ doi: undefined, fullText: copy }))).toContain('url = {https://example.org/p.pdf}');
  });
});

describe('BibTeX entries', () => {
  it('emits an article with the core fields', () => {
    const out = bibtex(record());
    expect(out).toMatch(/^@article\{/);
    expect(out).toContain('A study of things');
    expect(out).toContain('year = {2020}');
    expect(out).toContain('journal = {Journal of Things}');
  });

  it('joins authors with " and "', () => {
    expect(bibtex(record())).toContain('author = {Lovelace, Ada and Babbage, Charles}');
  });

  it('abbreviates a long author list with "others" rather than dropping them silently', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Author ${i}`);
    const out = generateCitation(record({ authors: many }), { format: 'bibtex', maxAuthors: 3 });
    expect(out).toContain('author = {Author 0 and Author 1 and Author 2 and others}');
  });

  it('calls a preprint misc rather than article', () => {
    expect(bibtex(record({ stage: 'preprint' }))).toMatch(/^@misc\{/);
  });

  it('builds a cite key from author, year and title', () => {
    expect(bibtex(record())).toMatch(/^@article\{lovelace2020study,/);
  });

  it('honours the field toggles', () => {
    const out = generateCitation(record({ abstract: 'An abstract.', topics: ['crispr'] }), {
      format: 'bibtex', includeAbstract: false, includeKeywords: false, includeDOI: false, includeURL: false
    });
    expect(out).not.toContain('abstract');
    expect(out).not.toContain('keywords');
    expect(out).not.toContain('doi =');
    expect(out).not.toContain('url =');
  });
});

describe('RIS entries', () => {
  it('opens with a type and closes with ER', () => {
    const out = ris(record());
    expect(out.startsWith('TY  - JOUR')).toBe(true);
    expect(out.trimEnd().endsWith('ER  -')).toBe(true);
  });

  it('uses CRLF, as the format specifies', () => {
    expect(ris(record())).toContain('\r\n');
  });

  it('gives every author its own AU line', () => {
    const out = ris(record());
    expect(out).toContain('AU  - Lovelace, Ada');
    expect(out).toContain('AU  - Babbage, Charles');
  });

  it('gives every keyword its own KW line', () => {
    const out = ris(record({ topics: ['crispr', 'gene editing'] }));
    expect(out).toContain('KW  - crispr');
    expect(out).toContain('KW  - gene editing');
  });

  it('flattens a multi-line abstract, which would otherwise break the record', () => {
    const out = ris(record({ abstract: 'First line.\nSecond line.' }));
    expect(out).toContain('AB  - First line. Second line.');
  });

  it('calls a preprint GEN rather than JOUR', () => {
    expect(ris(record({ stage: 'preprint' }))).toContain('TY  - GEN');
  });
});

describe('generateCitationsBatch', () => {
  it('disambiguates cite keys that would otherwise collide', () => {
    // A .bib file with a repeated key silently loses an entry.
    const out = generateCitationsBatch(
      [record({ title: 'Study alpha things' }), record({ title: 'Study alpha widgets' })],
      { format: 'bibtex' }
    );
    const keys = Array.from(out.matchAll(/^@\w+\{([^,]+),/gm)).map(m => m[1]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the keys valid past the twenty-sixth repeat', () => {
    // One letter counted up from `a` gave the 28th `{`, which ends the entry.
    // Records like these all share the key `citation`.
    const bare = Array.from({ length: 30 }, () => record({ authors: [], year: undefined, title: 'On it' }));
    const keys = Array.from(generateCitationsBatch(bare, { format: 'bibtex' }).matchAll(/^@\w+\{([^,]+),/gm)).map(m => m[1]);

    expect(new Set(keys).size).toBe(30);
    for (const key of keys) expect(key).toMatch(/^citation[a-z]*$/);
    expect(keys.slice(25, 28)).toEqual(['citationy', 'citationz', 'citationaa']);
  });

  it('separates RIS records so each is its own entry', () => {
    const out = generateCitationsBatch([record(), record()], { format: 'ris' });
    expect(out.match(/^TY {2}- /gm)?.length).toBe(2);
    expect(out.match(/^ER {2}- ?$/gm)?.length).toBe(2);
  });
});

describe('robustness', () => {
  it('does not throw on a record missing everything optional', () => {
    const sparse: Paper = {
      id: 'x:1', title: 'Bare', authors: [], topics: [], oaStatus: 'unknown', stage: 'unknown',
      sources: [], fieldSources: {}
    };

    expect(() => generateCitation(sparse, { format: 'bibtex' })).not.toThrow();
    expect(() => generateCitation(sparse, { format: 'ris' })).not.toThrow();
    expect(bibtex(sparse)).toContain('Bare');
  });

  it('falls back to a usable cite key when there is nothing to build one from', () => {
    expect(citeKey({ title: '', authors: [], keywords: [], isPreprint: false } as any)).toBe('citation');
  });

  it('produces output for every declared format', () => {
    for (const format of ['bibtex', 'ris'] as const) {
      const out = generateCitation(record(), { format });
      expect(out, `${format} produced nothing`).toBeTruthy();
      expect(out).toContain('A study of things');
    }
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

describe('what a citation needs besides the venue', () => {
  const article = record({
    title: 'The new frontier of genome engineering with CRISPR-Cas9.',
    authors: ['Doudna, Jennifer A', 'Charpentier, Emmanuelle', 'WHO Collaborative Group'],
    year: 2014,
    venue: 'Science',
    biblio: { volume: '346', issue: '6213', firstPage: '1258096' },
    stage: 'published'
  });

  it('writes the volume, the issue and the pages into BibTeX', () => {
    const entry = generateCitation({ ...article, biblio: { volume: '521', issue: '7553', firstPage: '436', lastPage: '444' } }, { format: 'bibtex' });
    expect(entry).toContain('  volume = {521}');
    expect(entry).toContain('  number = {7553}');
    expect(entry).toContain('  pages = {436--444}');
  });

  it('writes them into RIS', () => {
    const entry = generateCitation({ ...article, biblio: { volume: '521', issue: '7553', firstPage: '436', lastPage: '444' } }, { format: 'ris' });
    expect(entry).toContain('VL  - 521');
    expect(entry).toContain('IS  - 7553');
    expect(entry).toContain('SP  - 436');
    expect(entry).toContain('EP  - 444');
  });

  it('braces the words a sentence-case style must not lower, and drops PubMed\'s closing full stop', () => {
    expect(generateCitation(article, { format: 'bibtex' })).toContain('  title = {The new frontier of genome engineering with {CRISPR-Cas9}}');
  });

  it('keeps a group\'s name whole, and reads "Surname, Forename" as BibTeX does', () => {
    const entry = generateCitation(article, { format: 'bibtex' });
    expect(entry).toContain('  author = {Doudna, Jennifer A and Charpentier, Emmanuelle and {WHO Collaborative Group}}');
    expect(entry).toMatch(/^@article\{doudna2014frontier,/);
  });
});
