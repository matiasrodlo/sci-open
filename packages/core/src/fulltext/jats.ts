import { parse, HTMLElement } from 'node-html-parser';
import type { Section } from './types';

/** What is not the paper's prose: tables, figures, references, notes. */
const NOT_PROSE = 'table-wrap, fig, ref-list, fn-group, supplementary-material, ack';

/** Direct children with this JATS tag name. `tagName` is upper-cased by the
 * parser — a `<sec>` reads `SEC` — so `rawTagName` is compared. */
const children = (el: HTMLElement, name: string): HTMLElement[] =>
  el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && n.rawTagName === name);

const clean = (text: string) => text.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();

/** Every element below `el` with this JATS tag name, `mml:math` included,
 * which a CSS selector would read as a pseudo-class. */
const descendants = (el: HTMLElement, name: string): HTMLElement[] => {
  const found: HTMLElement[] = [];
  const visit = (node: HTMLElement) => {
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.rawTagName === name) found.push(child);
      visit(child);
    }
  };
  visit(el);
  return found;
};

/**
 * A formula as its TeX where the JATS carries one — `<tex-math>`, or the
 * MathML's `alttext` — and as a visible placeholder where it is only an image,
 * so a sentence reads "exp(−α x Q) [formula] and" rather than closing over a
 * gap nobody can see.
 */
function formulaText(formula: HTMLElement): string {
  const tex = descendants(formula, 'tex-math')[0]?.text.trim();
  const alt = [...descendants(formula, 'mml:math'), ...descendants(formula, 'math')][0]?.getAttribute('alttext')?.trim();
  const source = tex || alt;
  return source ? ` $${source.replace(/^\$+|\$+$/g, '')}$ ` : ' [formula] ';
}

/** A structured abstract keeps its headings: "Background: …". */
function abstractText(abstract: HTMLElement): string {
  const parts = children(abstract, 'sec');
  if (!parts.length) {
    const paragraphs = children(abstract, 'p').map(p => clean(p.text)).filter(Boolean);
    return paragraphs.length ? paragraphs.join('\n\n') : clean(abstract.text);
  }
  return parts
    .map(part => {
      const heading = children(part, 'title')[0];
      const body = children(part, 'p').map(p => clean(p.text)).filter(Boolean).join(' ');
      return heading ? `${clean(heading.text).replace(/[:.]$/, '')}: ${body}` : body;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Europe PMC's JATS full text as sections: the abstract as `s0`, then each
 * `<sec>` of the body and its subsections, numbered by position. A section
 * whose prose is all in its subsections is kept with empty text: the outline
 * needs its title, and its children carry the words.
 */
export function jatsToSections(xml: string): { title?: string; license?: string; sections: Section[] } {
  const root = parse(xml, { lowerCaseTagName: false, comment: false });
  for (const el of root.querySelectorAll(NOT_PROSE)) el.remove();
  for (const formula of [...descendants(root, 'disp-formula'), ...descendants(root, 'inline-formula')]) {
    formula.replaceWith(formulaText(formula));
  }

  const sections: Section[] = [];
  const abstract = root.querySelector('abstract');
  if (abstract) sections.push({ id: 's0', title: 'Abstract', text: abstractText(abstract) });

  const walk = (sec: HTMLElement, id: string) => {
    const title = children(sec, 'title')[0];
    sections.push({
      id,
      title: (title && clean(title.text)) || 'Untitled section',
      text: children(sec, 'p').map(p => clean(p.text)).filter(Boolean).join('\n\n')
    });
    children(sec, 'sec').forEach((child, i) => walk(child, `${id}.${i + 1}`));
  };
  const body = root.querySelector('body');
  if (body) children(body, 'sec').forEach((sec, i) => walk(sec, `s${i + 1}`));
  // Appendices sit in <back>, after the body's sections and numbered on from them.
  const appendices = root.querySelectorAll('back app-group > app, back app');
  const offset = sections.filter(s => !s.id.includes('.') && s.id !== 's0').length;
  [...new Set(appendices)].forEach((app, i) => walk(app, `s${offset + i + 1}`));

  const title = root.querySelector('article-meta article-title');
  // The license's paragraphs: its whole text runs the license URL into the first sentence.
  const license = root.querySelectorAll('license license-p').map(p => clean(p.text)).join(' ');
  return {
    ...(title ? { title: clean(title.text) } : {}),
    ...(license ? { license: license.slice(0, 300) } : {}),
    sections
  };
}
