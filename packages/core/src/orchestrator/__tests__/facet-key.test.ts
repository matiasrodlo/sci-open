import { describe, it, expect } from 'vitest';
import { facetKey } from '../facet-key';

/**
 * `facetKey` splits on ASCII separators before it applies the Unicode rules,
 * so only words carrying other characters pay for them. That is only safe if
 * the answer is the one the rules give over the whole text — this is that
 * definition, and the cases below are where a per-word version could differ.
 */
const wholeText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

describe('facetKey', () => {
  it.each([
    ['Frontiers in Psychology', 'frontiers in psychology'],
    ['Café & Bar', 'cafe and bar'],
    ['Лечение COVID-19 у детей', 'лечение covid 19 у детеи'],
    ['新型冠状病毒肺炎的临床特征', '新型冠状病毒肺炎的临床特征'],
    ['CRISPR–Cas9 and α-synuclein', 'crispr cas9 and α synuclein'],
    ['Ｒ＆Ｄ', 'r and d'],
    ['ﬁnancial ½', 'financial 1 2'],
    ['a \u0301b', 'a b'],
    ['İstanbul', 'istanbul'],
    ['  --  ', '']
  ])('keys %j as %j', (value, key) => {
    expect(facetKey(value)).toBe(key);
    expect(facetKey(value)).toBe(wholeText(value));
  });

  it('keys a number as its digits', () => {
    expect(facetKey(2024)).toBe('2024');
  });

  it('answers the same for a word however often it has been seen', () => {
    // The slow path is memoised; a remembered answer must be the same answer.
    const first = facetKey('μm β-cells');
    expect(facetKey('μm β-cells')).toBe(first);
    expect(first).toBe(wholeText('μm β-cells'));
  });
});
