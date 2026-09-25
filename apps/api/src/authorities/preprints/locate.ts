/**
 * Where a preprint server serves a DOI's PDF, for the servers whose address
 * follows from the DOI alone.
 *
 * Each rule was measured against the live servers on 2026-09-25, and each is
 * only a candidate: `lookup` fetches it and keeps it only if a PDF comes back.
 * What is left out was measured too.
 *
 * - **Research Square**, `10.21203/rs.3.rs-{n}/v{m}` →
 *   `researchsquare.com/article/rs-{n}/v{m}.pdf`, which redirects once to the
 *   file. Versions 1 and 2 checked. The older `rs.2.` DOIs (27,000 in
 *   OpenAlex) are not the same number: `rs.2.17932/v2` read as
 *   `rs-17932/v2.pdf` is a 404.
 * - **bioRxiv**, `10.1101/{yyyy.mm.dd.}{nnnnnn}` → `biorxiv.org/content/{doi}.full.pdf`,
 *   which redirects to the latest version. Checked on 2024 and 2018 DOIs. The
 *   prefix is Cold Spring Harbor's and shared: its journals (`10.1101/gr.…`)
 *   have letters, and medRxiv's numbers run to eight digits.
 * - **OSF** and the servers it hosts — OSF Preprints, PsyArXiv, SocArXiv and
 *   the rest — `10.{prefix}/osf.io/{guid}` → `osf.io/{guid}/download`, which
 *   serves the preprint's current file. A `_v2` suffix is dropped: the
 *   versioned address answers with a web page, not the file, so the copy is
 *   the current version rather than the one the DOI names.
 *
 * Left out: medRxiv, which answers every PDF address built from a DOI with 403
 * — its bot protection — while serving the ones OpenAlex records under
 * `/content/medrxiv/early/…`, a path with a date the DOI does not carry; SSRN,
 * Preprints.org and ChemRxiv, behind the same kind of protection; eLife, whose
 * `.pdf` address answers with a web page.
 */

const RESEARCH_SQUARE = /^10\.21203\/rs\.3\.(rs-\d+)\/(v\d+)$/i;
const BIORXIV = /^10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.)?\d{6,7}$/;
const OSF = /^10\.\d{4,9}\/osf\.io\/([a-z0-9]{5,})(?:_v\d+)?$/i;

export function locate(doi: string | undefined): string | undefined {
  const value = doi?.trim();
  if (!value) return undefined;

  const researchSquare = value.match(RESEARCH_SQUARE);
  if (researchSquare) {
    return `https://www.researchsquare.com/article/${researchSquare[1]!.toLowerCase()}/${researchSquare[2]!.toLowerCase()}.pdf`;
  }

  if (BIORXIV.test(value)) return `https://www.biorxiv.org/content/${value}.full.pdf`;

  const osf = value.match(OSF);
  if (osf) return `https://osf.io/${osf[1]!.toLowerCase()}/download`;

  return undefined;
}
