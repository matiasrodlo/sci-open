import { describe, it, expect } from 'vitest';
import type { SourceRef } from '@open-access-explorer/shared';
import { accessRoute, copyLabel, copyNote, foundIn, landingLabel, notableStage, stageLabel } from '../access';

const ref = (provider: SourceRef['provider']): SourceRef =>
  ({ provider, nativeId: '1', rank: 0, retrievedAt: '2026-01-01T00:00:00.000Z' });

describe('how a paper is open', () => {
  it('names the routes that say something', () => {
    expect(accessRoute('gold')?.label).toBe('Gold OA');
    expect(accessRoute('green')?.note).toMatch(/repository/);
  });

  it('says nothing for a route that is closed or not known', () => {
    expect(accessRoute('closed')).toBeUndefined();
    expect(accessRoute('unknown')).toBeUndefined();
  });
});

describe('which version it is', () => {
  it('is a separate question from how it is open', () => {
    // Version 1 put `published` in the field called `oaStatus`.
    expect(stageLabel('published')).toBe('Published version');
    expect(stageLabel('unknown')).toBeUndefined();
  });

  it('is worth a card’s space only when it is not the version of record', () => {
    expect(notableStage('preprint')).toBe('Preprint');
    expect(notableStage('accepted')).toBe('Accepted manuscript');
    expect(notableStage('published')).toBeUndefined();
  });
});

describe('which sources returned it', () => {
  it('names each once, in the order they were merged', () => {
    expect(foundIn({ sources: [ref('europepmc'), ref('ncbi'), ref('europepmc'), ref('openalex')] }))
      .toEqual(['Europe PMC', 'PubMed', 'OpenAlex']);
  });

  it('is empty for a record that carries none', () => {
    expect(foundIn({ sources: [] })).toEqual([]);
  });
});

describe('what its copy is', () => {
  it('calls a web page full text, not a PDF', () => {
    // Every copy was `bestPdfUrl` in version 1, so a reader page from CORE or
    // an article page from DOAJ was offered on a button that said "PDF".
    expect(copyLabel({ url: 'https://example.org/a', kind: 'html', verified: false })).toBe('Full text');
    expect(copyLabel({ url: 'https://example.org/a.pdf', kind: 'pdf', verified: false })).toBe('PDF');
  });

  it('says whether anyone checked, and reads unchecked as unchecked', () => {
    expect(copyNote({ url: 'https://example.org/a.pdf', kind: 'pdf', verified: true })).toMatch(/^PDF, checked/);
    expect(copyNote({ url: 'https://example.org/a.pdf', kind: 'pdf', verified: false })).toMatch(/not checked$/);
  });
});

describe('what a link to the paper’s page says', () => {
  it('names the host it goes to, not the provider that returned the record', () => {
    // It said "View on OPENALEX" for OpenAlex's records, whose page is a DOI
    // link to the publisher.
    expect(landingLabel('https://pubmed.ncbi.nlm.nih.gov/123/')).toBe('View on pubmed.ncbi.nlm.nih.gov');
    expect(landingLabel('https://www.biorxiv.org/content/10.1101/1v1')).toBe('View on biorxiv.org');
  });

  it('says a DOI link is one, since doi.org only redirects', () => {
    expect(landingLabel('https://doi.org/10.1371/journal.pone.0265114')).toBe('View via DOI');
    expect(landingLabel('https://dx.doi.org/10.1/x')).toBe('View via DOI');
  });

  it('still says something for a link that does not parse', () => {
    expect(landingLabel('not a url')).toBe('View the record');
  });
});
