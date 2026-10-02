import { parse, HTMLElement } from 'node-html-parser';
import type { Section } from './types';

/** What a reader cannot see, and so must not reach a model either. */
const HIDDEN = 'script, style, noscript, [hidden], [aria-hidden="true"]';
const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])/i;

/** LaTeXML's furniture, which is not the paper's prose. */
const NOT_PROSE = '.ltx_bibliography, figure, .ltx_note, .ltx_page_navbar, .ltx_page_footer, .ltx_authors, .ltx_dates';

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

const subsections = (el: HTMLElement): HTMLElement[] =>
  el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && n.rawTagName === 'section');

const prose = (el: HTMLElement): string =>
  el.childNodes
    .filter((n): n is HTMLElement => n instanceof HTMLElement && (n.classList.contains('ltx_para') || n.classList.contains('ltx_paragraph')))
    .map(p => clean(p.text))
    .filter(Boolean)
    .join('\n\n');

/**
 * An arXiv HTML rendering (LaTeXML) as sections: `.ltx_abstract` as `s0`,
 * then each `<section>` of the document and its subsections, numbered by
 * position, appendices included.
 *
 * Hidden elements are removed before any text is read. Instructions hidden in
 * papers are a documented attack on AI readers, and an element styled out of
 * sight is where an HTML version of one sits.
 */
export function arxivHtmlToSections(html: string): { title?: string; sections: Section[] } {
  const root = parse(html, { comment: false });
  for (const el of root.querySelectorAll(HIDDEN)) el.remove();
  for (const el of root.querySelectorAll('[style]')) {
    if (HIDDEN_STYLE.test(el.getAttribute('style') ?? '')) el.remove();
  }
  // A formula as its TeX: the text of LaTeXML's MathML is a jumble of glyphs.
  for (const math of root.querySelectorAll('math')) math.replaceWith(` $${math.getAttribute('alttext') ?? ''}$ `);
  for (const el of root.querySelectorAll(NOT_PROSE)) el.remove();

  const sections: Section[] = [];
  const abstract = root.querySelector('.ltx_abstract');
  if (abstract) {
    sections.push({ id: 's0', title: 'Abstract', text: abstract.querySelectorAll('.ltx_p').map(p => clean(p.text)).join('\n\n') });
  }

  const walk = (sec: HTMLElement, id: string) => {
    const heading = sec.querySelector('.ltx_title');
    sections.push({ id, title: (heading && clean(heading.text)) || 'Untitled section', text: prose(sec) });
    subsections(sec).forEach((child, i) => walk(child, `${id}.${i + 1}`));
  };
  subsections(root.querySelector('article.ltx_document') ?? root).forEach((sec, i) => walk(sec, `s${i + 1}`));

  const title = root.querySelector('.ltx_title_document');
  return { ...(title ? { title: clean(title.text) } : {}), sections };
}
