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
  hal: 'HAL',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * Every source a record can come from, in the order the home page names them.
 *
 * Not every one of them is sent every search. A source is asked only what it
 * can answer — bioRxiv and medRxiv take a DOI and nothing else, and others are
 * skipped for queries they would run badly — and the results page says which
 * were asked. So this is a list of where papers come from, and the page that
 * shows it does not count it as "searched together".
 *
 * A record keyed on `ProviderId` rather than a list, so a provider added to
 * the shared type is a compile error here until it is placed — the page that
 * names the sources cannot quietly fall behind them. The numbers are
 * only the order: the large general indexes first, then the subject and
 * preprint servers and HAL's open archive, then the aggregators.
 *
 * medRxiv has no provider of its own — the bioRxiv one asks both servers and
 * tags each record with the one that answered — but it is a source a reader
 * would look for by name, and its records carry that name.
 */
const SOURCE_ORDER: Record<ProviderId, number> = {
  openalex: 1,
  europepmc: 2,
  ncbi: 3,
  arxiv: 4,
  biorxiv: 5,
  medrxiv: 6,
  hal: 7,
  doaj: 8,
  plos: 9,
  openaire: 10,
  core: 11,
  datacite: 12,
};

export const SOURCES: readonly string[] = (Object.keys(SOURCE_ORDER) as ProviderId[])
  .sort((a, b) => SOURCE_ORDER[a] - SOURCE_ORDER[b])
  .map(providerLabel);

/**
 * The authorities a record is checked against after it is found: never
 * searched, only asked about papers the sources returned. See `ProviderId`.
 */
export const AUTHORITIES: readonly string[] = ['crossref', 'unpaywall', 'opencitations'].map(providerLabel);
