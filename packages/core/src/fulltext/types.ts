/**
 * A paper's full text as `read_paper` serves it: sections with stable ids, so
 * an outline can be read first and a section asked for by id afterwards.
 *
 * Ids are the same whichever tier answered: `s0` the abstract, `s1`, `s1.2`,
 * `s1.2.3` the body's sections and their subsections, `p1`, `p2` the pages of a
 * PDF, which has pages rather than sections.
 */
export type FullTextTier = 'europepmc-jats' | 'arxiv-html' | 'pdf';

export type Section = { id: string; title: string; text: string };

export type FullTextDocument = {
  paperId: string;
  tier: FullTextTier;
  /** Where the text was read from. */
  url: string;
  license?: string;
  title?: string;
  sections: Section[];
  totalChars: number;
  retrievedAt: string;
};
