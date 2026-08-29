import { ProviderTotal } from '@open-access-explorer/shared';

const PROVIDER_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
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

interface ProviderCoverageProps {
  providers: ProviderTotal[];
}

/**
 * What each provider reports for this query, next to how much of it this search
 * actually pulled back.
 *
 * The counts are shown per provider and never added together: the corpora
 * overlap heavily, so the same paper is in several of them and a combined
 * figure would be meaningless.
 */
export function ProviderCoverage({ providers }: ProviderCoverageProps) {
  const contributing = providers
    .filter(p => p.retrieved > 0 || typeof p.totalHits === 'number')
    .sort((a, b) => (b.totalHits ?? 0) - (a.totalHits ?? 0));

  if (contributing.length === 0) {
    return null;
  }

  const failed = providers.filter(p => p.error);

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sources searched
        </h2>
        <span className="text-xs text-muted-foreground">
          matching in each source · retrieved here
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
        {contributing.map(provider => (
          <li key={provider.source} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate" title={PROVIDER_LABELS[provider.source] || provider.source}>
              {PROVIDER_LABELS[provider.source] || provider.source}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {typeof provider.totalHits === 'number'
                ? provider.totalHits.toLocaleString()
                : '—'}
              <span className="opacity-60"> · {provider.retrieved.toLocaleString()}</span>
            </span>
          </li>
        ))}
      </ul>

      {failed.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Unavailable for this search: {failed.map(p => PROVIDER_LABELS[p.source] || p.source).join(', ')}
        </p>
      )}
    </div>
  );
}
