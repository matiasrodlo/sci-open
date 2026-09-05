import { describe, it, expect } from 'vitest';
import { fullTextAt, isLocator } from '../full-text';

/**
 * `passesPolicy` admits a paper on `fullText` being present, and the header
 * calls what survives "retrievable". Nothing between the two asked what the URL
 * pointed at, so a record advertising its own DOI as its full text was counted
 * as a paper you could read — 791 of 1,530 non-PDF values across three live
 * searches. The counts behind each case below are in `full-text.ts`.
 */
describe('URLs that locate a paper rather than carry it', () => {
  it.each([
    ['https://doi.org/10.1016/j.enzmictec.2025.110799', 'the DOI resolver'],
    ['https://dx.doi.org/10.1000/xyz', 'its older host'],
    ['http://DOI.ORG/10.1000/xyz', 'host comparison is case-insensitive'],
    ['https://www.doi.org/10.1000/xyz', 'with the www'],
    ['https://hdl.handle.net/11250/3153859', 'the Handle resolver'],
    ['https://pubmed.ncbi.nlm.nih.gov/41442816', 'an abstract page'],
    ['https://arxiv.org/abs/2604.17626', 'an abstract page'],
    ['https://dblp.org/rec/journals/sle/BecirovicPT25a.html', 'a bibliography entry'],
    ['https://doaj.org/article/c620973886194c4b8ee46c639b883569', "DOAJ's record page"]
  ])('rejects %s (%s)', url => {
    expect(isLocator(url)).toBe(true);
    expect(fullTextAt(url, 'html')).toBeUndefined();
  });

  it('rejects one even when a provider insists it is a PDF', () => {
    // The kind is the provider's claim about the file. It says nothing about
    // whether the URL leads to one, which is the whole reason this exists.
    expect(fullTextAt('https://doi.org/10.1000/xyz', 'pdf')).toBeUndefined();
  });
});

/**
 * A host is never rejected outright. `arxiv.org` serves both the abstract and
 * the paper, and the whole value of the provider is the second one.
 */
describe('URLs that are the paper', () => {
  it.each([
    ['https://arxiv.org/pdf/2604.17626v1', 'the same host, the other path'],
    ['https://europepmc.org/articles/PMC123?pdf=render', 'a rendered PDF'],
    ['https://journals.plos.org/plosone/article/file?id=10.1371/x&type=printable', 'a file endpoint'],
    ['https://repository.example.org/items/1234', 'a repository page — optimistic, not false'],
    ['https://doi.example.org/10.1000/xyz', 'a host that merely contains "doi"'],
    ['https://notdoi.org/10.1000/xyz', 'a host that ends in the resolver name']
  ])('accepts %s (%s)', url => {
    expect(isLocator(url)).toBe(false);
    expect(fullTextAt(url, 'pdf')).toEqual({ url, kind: 'pdf', verified: false });
  });
});

describe('what it inherits from httpUrl', () => {
  it.each([
    'javascript:alert(document.domain)//evil.pdf',
    'data:text/html,<script>alert(1)</script>#x.pdf',
    '/articles/1.pdf',
    'not a url',
    ''
  ])('rejects %s, so no normaliser has to remember to screen it', url => {
    expect(fullTextAt(url, 'pdf')).toBeUndefined();
  });

  it.each([undefined, null, 42, {}])('rejects the non-string %s', value => {
    expect(fullTextAt(value, 'pdf')).toBeUndefined();
  });

  it('keeps the URL exactly as given', () => {
    // Not re-serialised through `URL`, which would rewrite the query string of
    // a PDF endpoint that is sensitive to it.
    const url = 'https://example.org/article/file?id=10.1371/journal.x&type=printable';
    expect(fullTextAt(url, 'pdf')!.url).toBe(url);
  });
});

describe('verified', () => {
  it('is false on everything, because nothing fetches a copy to check', () => {
    expect(fullTextAt('https://example.org/paper.pdf', 'pdf')!.verified).toBe(false);
  });
});
