import type { ProviderId } from '@open-access-explorer/shared';

/** How each provider and authority is named on the page. */
export const PROVIDER_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  unpaywall: 'Unpaywall',
  opencitations: 'OpenCitations',
  preprints: 'Preprint servers',
  europepmc: 'Europe PMC',
  ncbi: 'PubMed',
  arxiv: 'arXiv',
  doaj: 'DOAJ',
  plos: 'PLOS',
  openaire: 'OpenAIRE',
  core: 'CORE',
  datacite: 'DataCite',
  biorxiv: 'bioRxiv',
  medrxiv: 'medRxiv',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * The sources a search is sent to, in the order the home page names them.
 *
 * A record keyed on `ProviderId` rather than a list, so a provider added to
 * the shared type is a compile error here until it is placed — the page that
 * says what is searched cannot quietly fall behind what is. The numbers are
 * only the order: the large general indexes first, then the subject and
 * preprint servers, then the aggregators.
 *
 * medRxiv has no provider of its own — the bioRxiv one asks both servers and
 * tags each record with the one that answered — but it is a source a reader
 * would look for by name, and its records carry that name.
 */
const SEARCH_ORDER: Record<ProviderId, number> = {
  openalex: 1,
  europepmc: 2,
  ncbi: 3,
  arxiv: 4,
  biorxiv: 5,
  medrxiv: 6,
  doaj: 7,
  plos: 8,
  openaire: 9,
  core: 10,
  datacite: 11,
};

export const SEARCHED_SOURCES: readonly string[] = (Object.keys(SEARCH_ORDER) as ProviderId[])
  .sort((a, b) => SEARCH_ORDER[a] - SEARCH_ORDER[b])
  .map(providerLabel);

/**
 * The authorities a record is checked against after it is found: never
 * searched, only asked about papers the sources returned. See `ProviderId`.
 */
export const AUTHORITIES: readonly string[] = ['crossref', 'unpaywall', 'opencitations'].map(providerLabel);
