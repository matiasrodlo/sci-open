import { ProviderTotal } from '@open-access-explorer/shared';
import { AlertTriangle } from 'lucide-react';

const PROVIDER_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  unpaywall: 'Unpaywall',
  opencitations: 'OpenCitations',
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
  /**
   * False when a provider failed or timed out, which makes the reported total
   * a lower bound rather than an answer. Absent on the old search path, which
   * never reported it — treated as "not known to be degraded".
   */
  complete?: boolean;
}

/**
 * What each provider reports for this query, next to how much of it this search
 * actually pulled back — and which of them did not answer.
 *
 * The counts are shown per provider and never added together: the corpora
 * overlap heavily, so the same paper is in several of them and a combined
 * figure would be meaningless.
 *
 * The three outcomes are kept apart on purpose, because the whole point of
 * `ProviderReport` was that they are different things. A provider that was
 * *skipped* declined to guess — CORE and DataCite have no keyword index worth
 * the name, and the backend says so rather than sending a query it knows will
 * be answered badly. A provider that *failed* was asked and did not answer,
 * and that is the one that makes the total a lower bound. Reporting a skip as
 * a failure is the bug phase 08 fixed in the comparison sweep, and it would be
 * the same bug here.
 */
export function ProviderCoverage({ providers, complete }: ProviderCoverageProps) {
  const skipped = providers.filter(p => p.error?.startsWith('skipped:'));
  const failed = providers.filter(p => p.error && !p.error.startsWith('skipped:'));
  const answered = providers
    .filter(p => !p.error && (p.retrieved > 0 || typeof p.totalHits === 'number'))
    .sort((a, b) => (b.totalHits ?? 0) - (a.totalHits ?? 0));

  if (answered.length === 0 && failed.length === 0 && skipped.length === 0) {
    return null;
  }

  const label = (source: string) => PROVIDER_LABELS[source] || source;
  const degraded = complete === false || failed.length > 0;

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
        {answered.map(provider => (
          <li key={provider.source} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate" title={label(provider.source)}>
              {label(provider.source)}
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

      {degraded && (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-amber-900 dark:text-amber-200">
            <span className="font-medium">This search is incomplete.</span>{' '}
            {failed.length > 0 ? (
              <>
                {failed.map(p => label(p.source)).join(', ')}{' '}
                {failed.length === 1 ? 'did not answer' : 'did not answer'}, so the count
                above is a lower bound — there are more matching papers than are shown.
              </>
            ) : (
              <>
                At least one source did not answer, so the count above is a lower bound.
              </>
            )}
          </p>
        </div>
      )}

      {skipped.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Not searched for this query: {skipped.map(p => label(p.source)).join(', ')}
          <span className="opacity-70"> — no keyword index for it.</span>
        </p>
      )}
    </div>
  );
}
