import type { FullText, OaRoute, Paper, PaperStage } from '@open-access-explorer/shared';
import { providerLabel } from './provider-labels';

/**
 * What version 2 of the response says about a paper that version 1 could not,
 * in the words the page uses for it: how it is open, which version it is,
 * which sources returned it, and what its copy is.
 *
 * Version 1 had one `oaStatus` that held the version under an access-route
 * name, one source per record, and a `bestPdfUrl` that was whatever copy the
 * record named — so a copy that is a web page was offered as "PDF", and the
 * detail page's "Access Status" printed "published".
 */

/**
 * The routes that tell a reader something, in Unpaywall's sense of them.
 * `closed` and `unknown` are absent: neither is worth a label on a paper this
 * service found open, and `unknown` is not a claim at all.
 */
const ROUTES: Partial<Record<OaRoute, { label: string; note: string }>> = {
  gold: { label: 'Gold OA', note: 'Published open access, in an open-access journal' },
  hybrid: { label: 'Hybrid OA', note: 'Published open access, in a subscription journal' },
  bronze: { label: 'Bronze OA', note: 'Free to read on the publisher’s site, with no open licence stated' },
  green: { label: 'Green OA', note: 'Free to read as a copy in a repository' }
};

export function accessRoute(route: OaRoute): { label: string; note: string } | undefined {
  return ROUTES[route];
}

const STAGES: Record<PaperStage, string | undefined> = {
  preprint: 'Preprint',
  accepted: 'Accepted manuscript',
  published: 'Published version',
  unknown: undefined
};

export function stageLabel(stage: PaperStage): string | undefined {
  return STAGES[stage];
}

/**
 * The version, when it is one a reader should be told about before citing:
 * anything but the version of record. Every card saying "Published version"
 * would be noise around the two that matter.
 */
export function notableStage(stage: PaperStage): string | undefined {
  return stage === 'preprint' || stage === 'accepted' ? STAGES[stage] : undefined;
}

/** Every provider that returned this paper, named once each, in the order they were merged. */
export function foundIn(paper: Pick<Paper, 'sources'>): string[] {
  return Array.from(new Set((paper.sources ?? []).map(source => source.provider)), providerLabel);
}

/** What a button offering the copy calls it: a PDF only when the record says it is one. */
export function copyLabel(copy: FullText): string {
  return copy.kind === 'pdf' ? 'PDF' : 'Full text';
}

/**
 * Whether anyone has looked. `verified` is set only once the file was fetched
 * and read as a PDF; false means not checked, never checked-and-absent.
 */
export function copyNote(copy: FullText): string {
  const what = copy.kind === 'pdf' ? 'PDF' : 'Web page';
  return copy.verified
    ? `${what}, checked: the link was fetched and a PDF came back`
    : `${what}, as the source recorded it — not checked`;
}

/**
 * What a link to the paper's page says, which is where it goes.
 *
 * A DOI link says so rather than naming `doi.org`, which only redirects: the
 * page is wherever the DOI's registrant points it.
 */
export function landingLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'View the record';
  }
  return /^(dx\.)?doi\.org$/.test(host) ? 'View via DOI' : `View on ${host}`;
}
