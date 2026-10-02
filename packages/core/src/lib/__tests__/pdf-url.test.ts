import { describe, it, expect } from 'vitest';
import { preferredPdfUrl, servesInterstitial } from '../pdf-url';

/**
 * The one URL substitution the service makes, and the measurement behind it.
 *
 * Measured 2026-08-30 over twenty works offering both a publisher and a
 * repository PDF: the repository copy served a real file 6/20 as Unpaywall
 * gives it and 19/20 once these rewrites are applied. Thirteen of the twenty
 * repository URLs were the PMC download gate.
 */
describe('preferredPdfUrl', () => {
  it('rewrites the PMC download gate to Europe PMC', () => {
    expect(preferredPdfUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC10328345/pdf/fpls-14-1164461.pdf'))
      .toBe('https://europepmc.org/articles/PMC10328345?pdf=render');
  });

  it('rewrites the legacy ncbi.nlm.nih.gov spelling too', () => {
    expect(preferredPdfUrl('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4413877/pdf/srep09811.pdf'))
      .toBe('https://europepmc.org/articles/PMC4413877?pdf=render');
  });

  it('leaves a PMC article page alone — only the /pdf/ endpoint is gated', () => {
    const landing = 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4413877';
    expect(preferredPdfUrl(landing)).toBe(landing);
  });

  it('leaves publisher PDFs alone, including the ones that answer 403', () => {
    // There is no alternative to substitute for these, and inventing one would
    // trade a measured failure for a guess.
    for (const url of [
      'https://academic.oup.com/nar/advance-article-pdf/doi/10.1093/nar/gkae419/x/gkae419.pdf',
      'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/advs.202206433',
      'https://www.nature.com/articles/srep09811.pdf'
    ]) {
      expect(preferredPdfUrl(url)).toBe(url);
    }
  });

  it('returns a URL it cannot parse unchanged rather than throwing', () => {
    expect(preferredPdfUrl('not a url')).toBe('not a url');
  });
});

describe('servesInterstitial', () => {
  it('recognises the gate and nothing else', () => {
    expect(servesInterstitial('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/pdf/x.pdf')).toBe(true);
    expect(servesInterstitial('https://europepmc.org/articles/PMC1?pdf=render')).toBe(false);
    expect(servesInterstitial('https://www.nature.com/articles/srep09811.pdf')).toBe(false);
    expect(servesInterstitial('nonsense')).toBe(false);
  });
});
