import { describe, it, expect } from 'vitest';
import { normalize, pickFullText, pickRoute, capabilities } from '../index';
import open from '../__fixtures__/open.json';
import closed from '../__fixtures__/closed.json';
import pmc from '../__fixtures__/pmc.json';

/**
 * Three recorded works: gold with both a publisher and a repository copy,
 * closed with none, and one whose repository copy is the PMC download gate.
 */
describe('unpaywall normalize', () => {
  const facts = normalize(open as any)!;

  it('reads the bibliographic fields it does carry', () => {
    expect(facts.title).toBe('Rapid generation of endogenously driven transcriptional reporters in cells through CRISPR/Cas9');
    expect(facts.venue).toBe('Scientific Reports');
    expect(facts.publisher).toBe('Springer Science and Business Media LLC');
    expect(facts.year).toBe(2015);
    expect(facts.authors?.[0]).toBe('Alejandro Rojas-Fernandez');
  });

  it('reads the author name Unpaywall actually returns', () => {
    // `z_authors` carries `raw_author_name`; the old client's interface
    // declared `{ given, family }`, and the template it built from them
    // produced the literal string "undefined undefined" once per author.
    const [author] = (open as any).z_authors;
    expect(author.raw_author_name).toBe('Alejandro Rojas-Fernandez');
    expect(author.given).toBeUndefined();
    expect(author.family).toBeUndefined();
    expect(facts.authors).not.toContain('undefined undefined');
  });

  it('claims nothing it does not return', () => {
    // `UnpaywallResponse` declared `abstract_inverted_index` and the old
    // converter reconstructed from it. It is absent from all three recorded
    // responses — v2 does not ship abstracts, topics or citation counts.
    for (const field of ['abstract', 'topics', 'citationCount'] as const) {
      expect(capabilities.fields).not.toContain(field);
      expect((open as any)[field === 'abstract' ? 'abstract_inverted_index' : field]).toBeUndefined();
    }
  });

  describe('the route', () => {
    it('reports the graded status rather than a boolean', () => {
      expect(facts.oaStatus).toBe('gold');
      expect(normalize(closed as any)!.oaStatus).toBe('closed');
    });

    it('falls back to is_oa only when there is no status to read', () => {
      expect(pickRoute({ is_oa: false })).toBe('closed');
      expect(pickRoute({ is_oa: true })).toBe('unknown');
      expect(pickRoute({})).toBe('unknown');
    });

    it('is the one field allowed to overwrite what a provider said', () => {
      expect(capabilities.authoritative).toContain('oaStatus');
    });
  });

  describe('the version', () => {
    it('reads the stage off the copy it chose', () => {
      expect(facts.stage).toBe('published');
    });

    it('has no stage to report for a work with no open copy', () => {
      expect(normalize(closed as any)!.stage).toBeUndefined();
    });
  });

  describe('pickFullText', () => {
    it('prefers the repository copy over the publisher copy', () => {
      // Measured over twenty pairs: publisher 11/20, repository 6/20 as given,
      // repository 19/20 once rewritten. The preference only pays with the
      // rewrite; inverting on host type alone made the number worse.
      expect(facts.fullText?.url).toBe('https://discovery.dundee.ac.uk/ws/files/7049472/srep09811.pdf');
    });

    it('rewrites a repository copy that is the PMC download gate', () => {
      // Unpaywall advertises pmc.ncbi.nlm.nih.gov/articles/PMC10328345/pdf/…,
      // which answers HTTP 200 text/html with a cookie-gate page.
      expect(normalize(pmc as any)!.fullText).toEqual({
        url: 'https://europepmc.org/articles/PMC10328345?pdf=render',
        kind: 'pdf',
        verified: false
      });
    });

    it('falls back to the publisher copy when there is no repository PDF', () => {
      expect(pickFullText({
        oa_locations: [{ host_type: 'publisher', url_for_pdf: 'https://example.org/a.pdf' }]
      })?.url).toBe('https://example.org/a.pdf');
    });

    it('ignores a location that lists no PDF', () => {
      // Two of the three locations on the recorded gold work have url_for_pdf
      // null — a landing page is not a copy we can serve.
      expect(pickFullText({
        oa_locations: [
          { host_type: 'repository', url_for_landing_page: 'https://example.org/record' },
          { host_type: 'publisher', url_for_pdf: 'https://example.org/a.pdf' }
        ]
      })?.url).toBe('https://example.org/a.pdf');
    });

    it('offers nothing for a closed work', () => {
      expect(normalize(closed as any)!.fullText).toBeUndefined();
    });

    it('does not claim to have verified a URL it never fetched', () => {
      expect(facts.fullText?.verified).toBe(false);
    });
  });

  it('returns null when there is no record', () => {
    expect(normalize(null)).toBeNull();
  });
});
