import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { jatsToSections } from '../jats';

/**
 * Europe PMC's JATS, as Tenaillon et al. 2007 (PMC1790863, PLoS ONE,
 * CC BY) was served on 2026-10-02.
 */
const recorded = jatsToSections(readFileSync(path.join(__dirname, '..', '__fixtures__', 'PMC1790863.xml'), 'utf8'));
const byId = (id: string) => recorded.sections.find(s => s.id === id);

describe('jatsToSections, on a recorded article', () => {
  it('reads the title and the license, not the license URL run into it', () => {
    expect(recorded.title).toBe('Quantifying Organismal Complexity using a Population Genetic Approach');
    expect(recorded.license).toMatch(/^This is an open-access article distributed under the terms of the Creative Commons Attribution License/);
  });

  it('numbers the body’s sections and their subsections, after the abstract', () => {
    expect(recorded.sections.map(s => s.id).slice(0, 6)).toEqual(['s0', 's1', 's2', 's2.1', 's2.2', 's2.3']);
    expect(recorded.sections.map(s => s.title).slice(0, 4)).toEqual(['Abstract', 'Introduction', 'Model and Results', 'Linear Fitness Decline']);
    expect(byId('s4.3.2')?.title).toBe('Ellipsoidal fitness isoclines');
    expect(recorded.sections).toHaveLength(22);
  });

  it('holds the prose, not the abstract alone', () => {
    expect(byId('s1')!.text.length).toBeGreaterThan(7000);
    expect(byId('s1')!.text).toMatch(/^A persistent question in biology is how organismal complexity/);
    expect(recorded.sections.reduce((n, s) => n + s.text.length, 0)).toBeGreaterThan(35_000);
  });

  it('keeps a section whose prose is all in its subsections, with no text of its own', () => {
    expect(byId('s4')).toEqual({ id: 's4', title: 'Methods', text: '' });
  });

  it('keeps the headings of a structured abstract', () => {
    expect(byId('s0')!.text).toMatch(/^Background: Various definitions of biological complexity/);
    expect(byId('s0')!.text).toContain('\n\nMethodology');
  });

  it('marks where a formula that is only an image was', () => {
    expect(byId('s4.3.1')!.text).toContain('[formula]');
  });

  it('leaves the reference list out', () => {
    expect(recorded.sections.some(s => /Sella and Hirsh.*Proc Natl Acad Sci/.test(s.text))).toBe(false);
  });
});

describe('jatsToSections, on what other articles carry', () => {
  const article = (body: string, back = '') =>
    `<article><front><article-meta><title-group><article-title>T</article-title></title-group><abstract><p>A.</p></abstract></article-meta></front><body>${body}</body><back>${back}</back></article>`;

  it('reads a formula as its TeX, from tex-math or from the MathML’s alttext', () => {
    const { sections } = jatsToSections(article(
      '<sec><title>M</title><p>Let <inline-formula><tex-math>x^2</tex-math></inline-formula> grow, and <disp-formula><mml:math alttext="y=mx+b"><mml:mi>y</mml:mi></mml:math></disp-formula> hold.</p></sec>'
    ));
    expect(sections[1]!.text).toBe('Let $x^2$ grow, and $y=mx+b$ hold.');
  });

  it('numbers appendices on from the body', () => {
    const { sections } = jatsToSections(article(
      '<sec><title>One</title><p>a</p></sec><sec><title>Two</title><p>b</p></sec>',
      '<app-group><app><title>Appendix A</title><p>c</p></app></app-group>'
    ));
    expect(sections.map(s => [s.id, s.title])).toEqual([['s0', 'Abstract'], ['s1', 'One'], ['s2', 'Two'], ['s3', 'Appendix A']]);
  });

  it('drops tables and figures but keeps their sentences', () => {
    const { sections } = jatsToSections(article(
      '<sec><title>R</title><p>See below.</p><table-wrap><caption><p>Table 1</p></caption><table><tr><td>9</td></tr></table></table-wrap><fig><caption><p>Figure 1</p></caption></fig><p>Done.</p></sec>'
    ));
    expect(sections[1]!.text).toBe('See below.\n\nDone.');
  });
});
