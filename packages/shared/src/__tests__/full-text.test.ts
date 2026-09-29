import { describe, it, expect } from 'vitest';
import { fullTextAt, isImage, isLocator, looksLikePdf } from '../full-text';

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

/**
 * The kind a normaliser gives a copy it has no other word on. Read off the
 * path alone, because a query string or fragment after `.pdf` is what made
 * `endsWith('.pdf')` call PDFs web pages.
 */
describe('URLs whose path names a PDF', () => {
  it.each([
    ['https://example.org/paper.pdf', 'the plain case'],
    ['https://escholarship.org/content/qt9qc3p2nq/qt9qc3p2nq.pdf?t=ouq2fd', 'a query string'],
    ['https://example.org/paper.pdf#page=2', 'a fragment'],
    ['https://example.org/PAPER.PDF', 'in capitals'],
    ['http://www.jbc.org/article/S0021925817502598/pdf', 'a bare pdf segment'],
    ['https://www.mdpi.com/2073-4425/12/3/358/pdf?version=1615888471', 'the same, with a query'],
    ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13509134/pdf/', 'the same, with a trailing slash']
  ])('accepts %s (%s)', url => {
    expect(looksLikePdf(url)).toBe(true);
  });

  it.each([
    ['https://repository.example.org/items/1234', 'a landing page'],
    ['https://onlinelibrary.wiley.com/doi/pdf/10.1002/adma.201907006', 'pdf before the last segment'],
    ['https://example.org/view?format=pdf', 'pdf only in the query'],
    ['https://example.org/view#paper.pdf', 'pdf only in the fragment'],
    ['https://example.org/pdfs', 'a segment that merely starts with pdf'],
    ['https://example.org/', 'no path at all'],
    ['not a url', 'nothing to parse']
  ])('rejects %s (%s)', url => {
    expect(looksLikePdf(url)).toBe(false);
  });
});

/**
 * A figure is not a copy in any format. Four of 618 OpenAlex `pdf_url` values
 * measured were Elsevier graphical abstracts, all answering 200 image/jpeg;
 * the numbers are in `full-text.ts`.
 */
describe('URLs whose path names an image', () => {
  it.each([
    ['https://ars.els-cdn.com/content/image/1-s2.0-S0160412017312321-fx1_lrg.jpg', 'the graphical abstract measured'],
    ['https://example.org/figure.PNG', 'in capitals'],
    ['https://example.org/figure.jpeg?w=800', 'a query string'],
    ['https://example.org/scan.tif', 'a scan']
  ])('rejects %s (%s)', url => {
    expect(isImage(url)).toBe(true);
    // Whatever kind the provider claimed for it.
    expect(fullTextAt(url, 'pdf')).toBeUndefined();
  });

  it.each([
    ['https://example.org/download?file=figure.jpg', 'an image only in the query'],
    ['https://arxiv.org/pdf/1605.08695', 'no extension, which is most real PDF endpoints'],
    ['https://example.org/images/paper.pdf', 'image only in an earlier segment'],
    ['not a url', 'nothing to parse']
  ])('accepts %s (%s)', url => {
    expect(isImage(url)).toBe(false);
  });
});

describe('verified', () => {
  it('is false on everything, because nothing fetches a copy to check', () => {
    expect(fullTextAt('https://example.org/paper.pdf', 'pdf')!.verified).toBe(false);
  });
});
