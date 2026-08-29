import { describe, it, expect } from 'vitest';
import { OpenAlexClient } from '../clients/openalex';
import { UnpaywallClient } from '../clients/unpaywall';

/**
 * OpenAlex and Unpaywall ship abstracts as an inverted index: word -> the
 * positions it occupies. Reconstruction has to put every occurrence back,
 * including the repeats, or common words silently vanish from the text.
 */
const INDEX: Record<string, number[]> = {
  the: [0, 3, 6],
  cat: [1],
  and: [2, 5],
  dog: [4],
  bird: [7]
};
const TEXT = 'the cat and the dog and the bird';

describe.each([
  ['OpenAlexClient', OpenAlexClient.reconstructAbstract],
  ['UnpaywallClient', UnpaywallClient.reconstructAbstract]
])('%s.reconstructAbstract', (_name, reconstruct) => {
  it('preserves words that occur more than once', () => {
    expect(reconstruct(INDEX)).toBe(TEXT);
  });

  it('orders words by position rather than by first appearance in the index', () => {
    expect(reconstruct({ world: [1], hello: [0] })).toBe('hello world');
  });

  it('returns an empty string for a missing or empty index', () => {
    expect(reconstruct(undefined as any)).toBe('');
    expect(reconstruct({})).toBe('');
  });
});
