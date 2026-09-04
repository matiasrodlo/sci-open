import { describe, it, expect } from 'vitest';
import { stripMarkup } from '../text';

describe('stripMarkup — the tags themselves', () => {
  it('removes the italics PLOS puts in a title', () => {
    // The reported bug: `/api/paper/plos:10.1371%2Fjournal.pone.0265114`
    // answered with the tags in the string, and the card printed them.
    expect(stripMarkup(
      'Optimization of CRISPR/LbCas12a-mediated gene editing in <i>Arabidopsis</i>'
    )).toBe('Optimization of CRISPR/LbCas12a-mediated gene editing in Arabidopsis');
  });

  it('removes a namespaced element', () => {
    expect(stripMarkup('<jats:p>one</jats:p>')).toBe('one');
  });

  it('removes a tag carrying attributes', () => {
    expect(stripMarkup('<jats:sec id="s1" xml:lang="en">body</jats:sec>')).toBe('body');
  });

  it('removes a self-closing tag', () => {
    expect(stripMarkup('one<br/>two')).toBe('one two');
  });
});

describe('stripMarkup — what a tag leaves behind', () => {
  it('joins across an inline element, which sits inside a word', () => {
    // Europe PMC's recorded abstract. Crossref's helper replaced every tag
    // with a space, which read `atring1 ko`.
    expect(stripMarkup('atring1<sup>ko</sup>')).toBe('atring1ko');
    expect(stripMarkup('H<sub>2</sub>O')).toBe('H2O');
  });

  it('breaks across a block element, which ends a run of text', () => {
    // OpenAIRE's helper replaced every tag with nothing, which read `onetwo`.
    expect(stripMarkup('<jats:p>one</jats:p><jats:p>two</jats:p>')).toBe('one two');
  });

  it('collapses the whitespace a stripped tag leaves behind', () => {
    expect(stripMarkup('<jats:p>one</jats:p>  <jats:p>two</jats:p>')).toBe('one two');
  });

  it('reads the element name without its namespace prefix', () => {
    // `jats:p` and `p` are the same element and break the text the same way.
    expect(stripMarkup('<p>one</p><p>two</p>')).toBe('one two');
    expect(stripMarkup('a<jats:sup>1</jats:sup>')).toBe('a1');
  });
});

describe('stripMarkup — what is not a tag', () => {
  it('keeps an inequality, which the obvious regex eats', () => {
    // `/<[^>]*>/` matches `< 0.05 and n >` and deletes it, turning a
    // measured result into `p 30`. PubMed ships exactly this string.
    expect(stripMarkup('p < 0.05 and n > 30')).toBe('p < 0.05 and n > 30');
  });

  it('keeps a comparison with no space around it', () => {
    expect(stripMarkup('cells at 37<10^6 per mL')).toBe('cells at 37<10^6 per mL');
  });

  it('keeps an inequality that arrives escaped', () => {
    expect(stripMarkup('significant at p &lt; 0.05')).toBe('significant at p < 0.05');
  });
});

describe('stripMarkup — entities', () => {
  it('decodes the ampersand DOAJ escapes in publisher strings', () => {
    expect(stripMarkup('Eye &amp; ENT Hospital')).toBe('Eye & ENT Hospital');
  });

  it("decodes &apos;, which OpenAIRE's list left out", () => {
    // Abstracts reached the reader as "Alzheimer&apos;s disease".
    expect(stripMarkup("Alzheimer&apos;s disease")).toBe("Alzheimer's disease");
    expect(stripMarkup('Alzheimer&#39;s disease')).toBe("Alzheimer's disease");
  });

  it('decodes &amp; last, so an escaped entity is not decoded twice', () => {
    // The record said `&quot;`, so that is what it should still say.
    expect(stripMarkup('a &amp;quot;quoted&amp;quot; word')).toBe('a &quot;quoted&quot; word');
  });

  it('leaves escaped markup visible rather than stripping it', () => {
    // `&lt;i&gt;` is a record that wanted to show the characters, not one with
    // an italic in it — decoding runs after the tags are gone.
    expect(stripMarkup('the &lt;i&gt; element')).toBe('the <i> element');
  });

  it('treats a non-breaking space as a space', () => {
    expect(stripMarkup('5&nbsp;mM')).toBe('5 mM');
  });
});

describe('stripMarkup — the value that is not text', () => {
  it('drops a value that is nothing but markup', () => {
    // An empty string written into `title` is a title; `undefined` lets the
    // caller drop the field, which is the honest report.
    expect(stripMarkup('<jats:p></jats:p>')).toBeUndefined();
    expect(stripMarkup('   ')).toBeUndefined();
  });

  it('drops a value that is not a string', () => {
    // Payload fields are whatever the provider put there. OpenAIRE's
    // `description` list carries a bare number among the abstracts.
    expect(stripMarkup(undefined)).toBeUndefined();
    expect(stripMarkup(null)).toBeUndefined();
    expect(stripMarkup(75)).toBeUndefined();
    expect(stripMarkup({ $: 'text' })).toBeUndefined();
  });
});

describe('stripMarkup — the "Abstract" heading', () => {
  it('drops the heading that repeats the field it is inside', () => {
    expect(stripMarkup('<jats:title>Abstract</jats:title><jats:p>Body.</jats:p>')).toBe('Body.');
  });

  it('drops it however it is cased and spaced', () => {
    expect(stripMarkup('<title>  ABSTRACT  </title><p>Body.</p>')).toBe('Body.');
  });

  it('keeps a title element that says something else', () => {
    expect(stripMarkup('<jats:title>Methods</jats:title><jats:p>Body.</jats:p>'))
      .toBe('Methods Body.');
  });

  it('keeps a body that merely begins with the word', () => {
    expect(stripMarkup('<jats:p>Abstract reasoning is hard.</jats:p>'))
      .toBe('Abstract reasoning is hard.');
  });
});

describe('stripMarkup — whitespace', () => {
  it('collapses the source document line wrapping', () => {
    // Solr returns PLOS abstracts with the leading newline and indentation
    // still on them; Crossref's JATS arrives the same way.
    expect(stripMarkup('\n      Body text\n      continues.\n    ')).toBe('Body text continues.');
  });
});
