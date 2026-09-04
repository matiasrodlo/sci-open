import { describe, it, expect } from 'vitest';
import { normalize, pickFullText, capabilities } from '../index';
import open from '../__fixtures__/open.json';
import closed from '../__fixtures__/closed.json';

/**
 * Two recorded works: `10.1038/srep09811`, gold open access, and
 * `10.1002/adma.201907006`, closed. Both carry a Crossref `license`, which is
 * the whole point of the pair — see the open-access test at the bottom.
 *
 * `reference` was dropped from both when they were recorded: 250 entries the
 * normaliser never reads.
 */
describe('crossref normalize', () => {
  const facts = normalize(open as any)!;

  it('reads the bibliographic fields', () => {
    expect(facts.title).toBe('Rapid generation of endogenously driven transcriptional reporters in cells through CRISPR/Cas9');
    expect(facts.venue).toBe('Scientific Reports');
    expect(facts.publisher).toBe('Springer Science and Business Media LLC');
    expect(facts.year).toBe(2015);
    expect(facts.language).toBe('en');
    expect(facts.citationCount).toBe(42);
    expect(facts.authors?.[0]).toBe('Alejandro Rojas-Fernandez');
    expect(facts.landingPage).toBe('https://doi.org/10.1038/srep09811');
    expect(facts.stage).toBe('published');
  });

  it('prefers the print year over the online one', () => {
    // The closed work was online in April 2020 and in print that September.
    expect(normalize(closed as any)!.year).toBe(2020);
  });

  it('returns null for a payload with no work in it', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize({} as any)).toBeNull();
  });

  describe('abstracts', () => {
    it('strips the JATS markup the old path passed through to the browser', () => {
      expect(facts.abstract).toMatch(/^CRISPR\/Cas9 technologies have been employed/);
      expect(facts.abstract).not.toContain('<');
    });

    it('drops the "Abstract" heading, which repeats the field it is inside', () => {
      expect(facts.abstract?.toLowerCase().startsWith('abstract')).toBe(false);
    });

    it('collapses the whitespace the stripped tags leave behind', () => {
      // The recorded abstract is one `<jats:p>` per paragraph, indented in the
      // source document. `stripMarkup`'s own suite pins the rule; this pins
      // that the recorded payload comes out of it as running prose.
      expect(facts.abstract).not.toMatch(/\s{2}/);
      expect(facts.abstract?.trim()).toBe(facts.abstract);
    });
  });

  describe('pickFullText', () => {
    it('takes a link that is actually a PDF', () => {
      expect(facts.fullText).toEqual({
        url: 'https://www.nature.com/articles/srep09811.pdf',
        kind: 'pdf',
        verified: false
      });
    });

    it('refuses a text-mining link that is not a PDF', () => {
      // The old `extractPdfLink` accepted any link whose intended-application
      // was `text-mining`, so for a work whose only such links are text/plain
      // and text/xml it wrote a plain-text URL into `bestPdfUrl`.
      expect(pickFullText({
        link: [
          { URL: 'https://example.org/a.txt', 'content-type': 'text/plain', 'intended-application': 'text-mining' },
          { URL: 'https://example.org/a.xml', 'content-type': 'text/xml', 'intended-application': 'text-mining' }
        ]
      })).toBeUndefined();
    });

    it('refuses a similarity-checking link, which is not a promise of access', () => {
      expect(pickFullText({
        link: [{ URL: 'https://example.org/a.pdf', 'content-type': 'application/pdf', 'intended-application': 'similarity-checking' }]
      })).toBeUndefined();
    });

    it('has nothing to offer when there are no links at all', () => {
      expect(pickFullText({})).toBeUndefined();
    });
  });

  describe('open access', () => {
    it('does not claim oaStatus at all', () => {
      expect(capabilities.fields).not.toContain('oaStatus');
      expect((facts as any).oaStatus).toBeUndefined();
    });

    it('says nothing about a closed work that carries a license', () => {
      // The measurement this pair exists for. Crossref lists exactly one
      // license for 10.1002/adma.201907006 — Wiley's all-rights-reserved terms
      // of use — and the old path's `extractLicense` returned 'Custom License'
      // for it, which was truthy, which became `oaStatus: 'published'`.
      // Unpaywall answers `is_oa: false, oa_status: "closed"`.
      const message = (closed as any).message;
      expect(message.license).toHaveLength(1);
      expect(message.license[0].URL).toContain('onlinelibrary.wiley.com/termsAndConditions');
      expect((normalize(closed as any) as any).oaStatus).toBeUndefined();
    });

    it('overwrites nothing, being a registrar rather than a referee', () => {
      expect(capabilities.authoritative).toEqual([]);
    });
  });
});
