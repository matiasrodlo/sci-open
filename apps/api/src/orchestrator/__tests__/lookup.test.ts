import { describe, it, expect, vi } from 'vitest';
import type { Paper, ProviderId } from '@open-access-explorer/shared';
import { lookupPaper, splitPaperId } from '../lookup';
import type { ProviderEntry, ProviderLookupArgs, ProviderSearchArgs } from '../registry';
import { paper, ref } from './helpers';

/**
 * The paper endpoint's whole behaviour, driven against fake providers.
 *
 * What is being pinned is the routing, not any provider's API: which of the
 * two ways to ask gets used, and what counts as having found the record. The
 * old route asked a connector for a page and returned `results[0]`, which is
 * how a "details" click could open a paper nobody asked for.
 */

const capabilities = {
  keywordSearch: true,
  doiLookup: true,
  fields: [] as const,
  yearFilter: false,
  maxPageSize: 100,
  reportsTotal: true,
  suppliesCitations: false
};

type Fake = ProviderEntry & {
  searched: ProviderSearchArgs[];
  lookedUp: ProviderLookupArgs[];
};

function provider(id: ProviderId, papers: Paper[], withLookup = false): Fake {
  const searched: ProviderSearchArgs[] = [];
  const lookedUp: ProviderLookupArgs[] = [];

  const entry: Fake = {
    id,
    capabilities,
    normalizerVersion: 1,
    translate: () => 'native',
    searched,
    lookedUp,
    async search(args) {
      searched.push(args);
      return { papers, skipped: [] };
    }
  };

  if (withLookup) {
    entry.lookup = async args => {
      lookedUp.push(args);
      return papers[0] ?? null;
    };
  }

  return entry;
}

const from = (id: ProviderId, nativeId: string) =>
  paper({ id: `${id}:${nativeId}`, sources: [ref(id, { nativeId })] });

describe('splitPaperId', () => {
  it('splits on the first colon, so an id containing colons survives', () => {
    // OpenAIRE's own ids carry a `::`, and a DOI can carry a colon too.
    expect(splitPaperId('openaire:doi_dedup___::abc')).toEqual({
      provider: 'openaire',
      nativeId: 'doi_dedup___::abc'
    });
    expect(splitPaperId('plos:10.1371/journal.pone.0265114')).toEqual({
      provider: 'plos',
      nativeId: '10.1371/journal.pone.0265114'
    });
  });

  it('reads a bare arXiv identifier as arXiv, which is the one unambiguous case', () => {
    expect(splitPaperId('2404.18021v2')).toEqual({ provider: 'arxiv', nativeId: '2404.18021v2' });
  });

  it('names no provider for an unprefixed id that is not one', () => {
    expect(splitPaperId('something')).toEqual({ nativeId: 'something' });
  });
});

describe('lookupPaper — which way it asks', () => {
  it('uses the by-id endpoint when the provider has one, and does not search', async () => {
    const openalex = provider('openalex', [from('openalex', 'W1')], true);

    const found = await lookupPaper('openalex:W1', { providers: [openalex] });

    expect(found?.id).toBe('openalex:W1');
    expect(openalex.lookedUp).toHaveLength(1);
    expect(openalex.lookedUp[0]!.nativeId).toBe('W1');
    expect(openalex.searched).toHaveLength(0);
  });

  it('searches the provider when it has no by-id endpoint', async () => {
    const arxiv = provider('arxiv', [from('arxiv', '2404.18021v2')]);

    const found = await lookupPaper('arxiv:2404.18021v2', { providers: [arxiv] });

    expect(found?.id).toBe('arxiv:2404.18021v2');
    expect(arxiv.searched).toHaveLength(1);
  });

  it('turns a DOI-shaped native id into a DOI query', async () => {
    // PLOS, DataCite and bioRxiv mint DOIs as their native ids, so the lookup
    // reaches each provider's exact path without this module listing which
    // ones those are.
    const plos = provider('plos', [from('plos', '10.1371/journal.pone.0265114')]);

    await lookupPaper('plos:10.1371/journal.pone.0265114', { providers: [plos] });

    expect(plos.searched[0]!.query.doi).toBe('10.1371/journal.pone.0265114');
    expect(plos.searched[0]!.query.terms).toEqual([]);
  });

  it('does not filter a lookup to open access', async () => {
    // Whether a paper is open access is a fact about it, not a condition on
    // being able to open its record.
    const arxiv = provider('arxiv', [from('arxiv', 'X')]);

    await lookupPaper('arxiv:X', { providers: [arxiv] });

    expect(arxiv.searched[0]!.openAccessOnly).toBe(false);
  });

  it('reads a shallow page, not a provider-sized one', async () => {
    // The old route asked each connector for its default page and threw away
    // everything after the match: 31 to 48 seconds per paper, measured.
    const arxiv = provider('arxiv', [from('arxiv', 'X')]);

    await lookupPaper('arxiv:X', { providers: [arxiv] });

    expect(arxiv.searched[0]!.depth).toBeLessThanOrEqual(10);
  });

  it('routes medrxiv to the bioRxiv provider, which is the one that serves it', async () => {
    // Records carry the server that answered, and there is no `medrxiv` entry.
    const biorxiv = provider('biorxiv', [
      paper({ id: 'medrxiv:10.1101/x', sources: [ref('medrxiv', { nativeId: '10.1101/x' })] })
    ]);

    const found = await lookupPaper('medrxiv:10.1101/x', { providers: [biorxiv] });

    expect(found?.id).toBe('medrxiv:10.1101/x');
  });
});

describe('lookupPaper — what counts as found', () => {
  it('returns the record that was asked for, not the first one that came back', async () => {
    const arxiv = provider('arxiv', [from('arxiv', 'OTHER'), from('arxiv', 'WANTED')]);

    const found = await lookupPaper('arxiv:WANTED', { providers: [arxiv] });

    expect(found?.id).toBe('arxiv:WANTED');
  });

  it('answers nothing rather than somebody else’s paper', async () => {
    const arxiv = provider('arxiv', [from('arxiv', 'OTHER')]);

    expect(await lookupPaper('arxiv:WANTED', { providers: [arxiv] })).toBeNull();
  });

  it('holds a by-id endpoint to the same answer, because one can normalise the id', async () => {
    // OpenAlex resolves `works/W0000000000` to `W0` and returns that record.
    // Unchecked, the endpoint answered a mistyped id with a real paper about
    // postpartum family planning in Ethiopia, under HTTP 200.
    const openalex = provider('openalex', [from('openalex', 'W0')], true);

    expect(await lookupPaper('openalex:W0000000000', { providers: [openalex] })).toBeNull();
    expect(openalex.lookedUp).toHaveLength(1);
  });

  it('compares DOIs without regard to case', async () => {
    // DOI suffixes are case-insensitive by convention, and providers differ on
    // which case they hand back.
    const plos = provider('plos', [from('plos', '10.1371/JOURNAL.pone.1')]);

    const found = await lookupPaper('plos:10.1371/journal.pone.1', { providers: [plos] });

    expect(found).not.toBeNull();
  });

  it('does not accept a record from a different provider', async () => {
    const arxiv = provider('arxiv', [from('europepmc', 'X')]);

    expect(await lookupPaper('arxiv:X', { providers: [arxiv] })).toBeNull();
  });

  it('answers nothing for an id naming a provider this service does not have', async () => {
    const arxiv = provider('arxiv', [from('arxiv', 'X')]);
    const spy = vi.spyOn(arxiv, 'search');

    expect(await lookupPaper('scopus:X', { providers: [arxiv] })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers nothing for an id with a provider and no record', async () => {
    const arxiv = provider('arxiv', [from('arxiv', 'X')]);

    expect(await lookupPaper('arxiv:', { providers: [arxiv] })).toBeNull();
  });
});
