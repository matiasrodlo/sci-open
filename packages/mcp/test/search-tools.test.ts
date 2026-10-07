import { describe, it, expect, vi } from 'vitest';
import type { Paper } from '@sci-open/shared';
import { paper, ref } from '@sci-open/core/testing';
import { searchPapers } from '../src/tools/search-papers';
import { getSearchPage } from '../src/tools/get-search-page';
import { getPaper } from '../src/tools/get-paper';
import { ToolError } from '../src/errors';
import { fakeEngine } from './fake-engine';

const study = (n: number): Paper =>
  paper({ id: `crossref:W${n}`, doi: `10.1234/s.${n}`, title: `Crispr study ${n}`, year: 2020, sources: [ref('crossref', { nativeId: `W${n}` })] });
const WORLD = Array.from({ length: 30 }, (_, i) => study(i + 1));

/** The tool's input as the SDK hands it over: parsed, defaults filled in. */
const searchArgs = (args: Record<string, unknown>) => searchPapers.input.parse(args);
const pageArgs = (args: Record<string, unknown>) => getSearchPage.input.parse(args);

describe('search_papers and get_search_page', () => {
  it('pages at the size the search asked for, so page 2 after a page of one is result 2', async () => {
    const { deps } = fakeEngine(WORLD);
    const first = await searchPapers.run(searchArgs({ query: 'crispr', page_size: 1 }), deps);
    expect(first.structured.results?.map(r => r.id)).toEqual(['crossref:W1']);

    const next = first.structured.next!;
    const second = await getSearchPage.run(pageArgs({ handle: next.handle, page: next.page }), deps);
    expect(second.structured.results.map(r => r.id)).toEqual(['crossref:W2']);
    expect(second.structured.page_size).toBe(1);
  });

  it('says when a page came from running the search again', async () => {
    const { deps } = fakeEngine(WORLD);
    const first = await searchPapers.run(searchArgs({ query: 'crispr' }), deps);
    const second = await getSearchPage.run(pageArgs({ handle: first.structured.handle!, page: 2 }), deps);
    expect(second.structured.rerun).toBe(true);
    expect(second.text).toContain('the search was run again for this page');
  });

  it('narrows the fan-out itself to the sources asked for', async () => {
    const { deps, engine } = fakeEngine(WORLD);
    const search = vi.spyOn(engine, 'search');
    await searchPapers.run(searchArgs({ query: 'crispr', sources: ['arxiv', 'crossref'] }), deps);
    expect(search.mock.calls[0]![1]).toMatchObject({ sources: ['arxiv', 'crossref'] });
  });

  it('counts facets across the sources only when asked, and pages that search as the same set', async () => {
    const { deps, engine } = fakeEngine(WORLD);
    const search = vi.spyOn(engine, 'search');

    const plain = await searchPapers.run(searchArgs({ query: 'crispr' }), deps);
    expect(search.mock.calls[0]![1]?.facets).toBeUndefined();

    const faceted = await searchPapers.run(searchArgs({ query: 'crispr', include_facets: true }), deps);
    expect(search.mock.calls[1]![1]).toMatchObject({ facets: true });
    expect(faceted.structured.handle).not.toBe(plain.structured.handle);

    // A page of it asks for the set its first page came from; asked without
    // the counts, it would be another set, resolved again.
    await getSearchPage.run(pageArgs({ handle: faceted.structured.handle!, page: 2 }), deps);
    expect(search.mock.calls[2]![1]).toMatchObject({ facets: true });
    await getSearchPage.run(pageArgs({ handle: plain.structured.handle!, page: 2 }), deps);
    expect(search.mock.calls[3]![1]?.facets).toBeUndefined();
    // The engine is sent a search, not the handle's own field.
    expect(search.mock.calls.every(([params]) => !('facets' in params))).toBe(true);
  });

  it('refuses a page past the end', async () => {
    const { deps } = fakeEngine(WORLD);
    const first = await searchPapers.run(searchArgs({ query: 'crispr', page_size: 25 }), deps);
    await expect(getSearchPage.run(pageArgs({ handle: first.structured.handle!, page: 3 }), deps))
      .rejects.toMatchObject({ code: 'not_found', message: 'Page 3 is past the end (30 results).' });
  });

  it.each([
    ['neither a query nor a DOI', {}],
    ['both a query and a DOI', { query: 'crispr', doi: '10.1234/x' }],
    ['a query of invisible characters', { query: '\u200B\u2060' }],
    ['years the wrong way round', { query: 'crispr', year_from: 2024, year_to: 2020 }],
    ['a count of a DOI', { doi: '10.1234/x', count_only: true }]
  ])('refuses %s, before spending an admission', async (_case, args) => {
    const { deps, admitted } = fakeEngine(WORLD);
    await expect(searchPapers.run(searchArgs(args), deps)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(admitted()).toBe(0);
  });

  it('refuses a syntax error with the parser’s position, before spending an admission', async () => {
    const { deps, admitted } = fakeEngine(WORLD);
    await expect(searchPapers.run(searchArgs({ query: 'crispr NEAR cas9' }), deps)).rejects.toThrow(/NEAR/);
    expect(admitted()).toBe(0);
  });

  it('says which words that look like operators were read as words, on every page and in counts', async () => {
    const { deps } = fakeEngine(WORLD);
    const read = { left_out: ['not', 'Or'], searched: ['near'] };
    const line = '**Read as words:** `not`, `Or` left out of the search; `near` searched as a word.';

    const first = await searchPapers.run(searchArgs({ query: 'crispr not near Or cas9' }), deps);
    expect(first.structured.query?.read_as_words).toEqual(read);
    expect(first.text).toContain(line);
    const again = await getSearchPage.run(pageArgs({ handle: first.structured.handle!, page: 1 }), deps);
    expect(again.text).toContain(line);

    const counted = await searchPapers.run(searchArgs({ query: 'crispr not near Or cas9', count_only: true }), deps);
    expect(counted.structured.counts?.read_as_words).toEqual(read);
    expect(counted.text).toContain(line);

    const plain = await searchPapers.run(searchArgs({ query: 'crispr OR cas9', count_only: true }), deps);
    expect(plain.structured.counts).not.toHaveProperty('read_as_words');
    expect(plain.text).not.toContain('Read as words');
  });

  it('leaves the tail of a page off to fit the budget, and says so', async () => {
    const { deps } = fakeEngine(WORLD);
    const tight = { ...deps, config: { ...deps.config, structuredBudgetChars: 2_000 } };
    const outcome = await searchPapers.run(searchArgs({ query: 'crispr', page_size: 25 }), tight);
    expect(outcome.structured.omitted_for_size).toBeGreaterThan(0);
    expect(outcome.structured.results!.length + outcome.structured.omitted_for_size!).toBe(25);
    expect(outcome.text).toContain('were omitted to fit the response limit');
  });

  it('looks a DOI up, given as a URL', async () => {
    const { deps } = fakeEngine(WORLD);
    const outcome = await searchPapers.run(searchArgs({ doi: 'https://doi.org/10.1234/s.7' }), deps);
    expect(outcome.structured.results?.map(r => r.id)).toEqual(['crossref:W7']);
    expect(outcome.structured.query).toEqual({ doi: '10.1234/s.7', sort: 'relevance' });
  });

  it('looks a DOI up written doi:10.…, and refuses a doi that is not one before asking anything', async () => {
    const { deps, searches } = fakeEngine(WORLD);
    const outcome = await searchPapers.run(searchArgs({ doi: 'doi:10.1234/s.7' }), deps);
    expect(outcome.structured.results?.map(r => r.id)).toEqual(['crossref:W7']);
    expect(outcome.structured.query).toEqual({ doi: '10.1234/s.7', sort: 'relevance' });

    // Searched as words, it would list somebody else's papers under that DOI.
    await expect(searchPapers.run(searchArgs({ doi: 'crispr study' }), deps)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(searches).toEqual(['10.1234/s.7']);
  });
});

describe('get_paper', () => {
  it('finds a paper by id, and says an id asks one source', async () => {
    const { deps, admitted } = fakeEngine(WORLD);
    const outcome = await getPaper.run({ id: 'crossref:W3' }, deps);
    expect(outcome.structured.paper).toMatchObject({ id: 'crossref:W3', field_sources: {}, sources: [{ source: 'crossref' }] });
    expect(outcome.text).toContain('looked up by id, which asks only that source');
    expect(admitted()).toBe(0);
  });

  it('finds a paper by DOI, spending an admission like any search', async () => {
    const { deps, admitted } = fakeEngine(WORLD);
    const outcome = await getPaper.run({ doi: 'https://doi.org/10.1234/s.4' }, deps);
    expect(outcome.structured.paper.id).toBe('crossref:W4');
    expect(admitted()).toBe(1);
  });

  it('reads a DOI in the forms the other tools print and citations write, as doi or as id', async () => {
    const { deps } = fakeEngine(WORLD);
    for (const args of [
      { doi: 'doi:10.1234/s.4' }, { doi: 'DOI: 10.1234/s.4' },
      { id: 'doi:10.1234/s.4' }, { id: '10.1234/s.4' }, { id: 'https://doi.org/10.1234/s.4' }
    ]) {
      const outcome = await getPaper.run(args, deps);
      expect(outcome.structured.paper.id, JSON.stringify(args)).toBe('crossref:W4');
      expect(outcome.text).not.toContain('looked up by id');
    }
  });

  it('reads an id written as its source writes it: arXiv:…, PMID: …', async () => {
    const preprint = paper({ id: 'arxiv:2101.00001v2', title: 'A preprint', sources: [ref('arxiv', { nativeId: '2101.00001v2' })] });
    const indexed = paper({ id: 'ncbi:33816816', title: 'An indexed paper', sources: [ref('ncbi', { nativeId: '33816816' })] });
    const { deps } = fakeEngine([preprint, indexed]);
    expect((await getPaper.run({ id: 'arXiv:2101.00001' }, deps)).structured.paper.id).toBe('arxiv:2101.00001v2');
    expect((await getPaper.run({ id: 'PMID: 33816816' }, deps)).structured.paper.id).toBe('ncbi:33816816');
  });

  it('says what to do when no source holds it, and refuses both or neither', async () => {
    const { deps } = fakeEngine(WORLD);
    await expect(getPaper.run({ id: 'crossref:W999' }, deps)).rejects.toMatchObject({ code: 'not_found' });
    await expect(getPaper.run({}, deps)).rejects.toBeInstanceOf(ToolError);
    await expect(getPaper.run({ id: 'crossref:W1', doi: '10.1234/s.1' }, deps)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
