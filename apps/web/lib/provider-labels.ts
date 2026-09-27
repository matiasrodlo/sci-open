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
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}
