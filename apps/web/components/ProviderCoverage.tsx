import { Fragment } from 'react';
import { ProviderTotal } from '@open-access-explorer/shared';
import { AlertTriangle } from 'lucide-react';
import { coverageOf, isFailed, isSkipped, skipsByReason } from '@/lib/coverage';

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
  /**
   * True when the rescue pass was cut short, which makes the total a lower
   * bound for a different reason: papers were dropped for want of a retrievable
   * copy without anyone being asked whether one exists.
   *
   * Reported separately because it needs different words. Every provider can
   * have answered perfectly and the count still be short, so the notice for
   * this case must not say a source failed.
   */
  bounded?: boolean;
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
 * *skipped* declined to guess, and the backend says so rather than sending a
 * query it knows will be answered badly. A provider that *failed* was asked
 * and did not answer, and that is the one that makes the total a lower bound.
 * Reporting a skip as a failure is the bug phase 08 fixed in the comparison
 * sweep, and it would be the same bug here.
 *
 * What this component does **not** do any more is say why a provider was
 * skipped. It used to print one sentence — "no keyword index for it" — for
 * every skip, which is true of bioRxiv and false of CORE (too slow) and
 * DataCite (nothing retrievable to contribute), the two it named most often.
 * The reason arrives with the report now; see `ProviderCapabilities.skipReason`.
 */
export function ProviderCoverage({ providers, complete, bounded }: ProviderCoverageProps) {
  const skipped = providers.filter(isSkipped);
  const failed = providers.filter(isFailed);
  const answered = providers
    .filter(p => !p.error && (p.retrieved > 0 || typeof p.totalHits === 'number'))
    .sort((a, b) => (b.totalHits ?? 0) - (a.totalHits ?? 0));

  if (answered.length === 0 && failed.length === 0 && skipped.length === 0) {
    return null;
  }

  const label = (source: string) => PROVIDER_LABELS[source] || source;

  // Two different reasons the count can be short, and the notice has to say
  // which one it is. A source that did not answer is a gap in the corpus; a
  // bounded rescue is a gap in what was asked about papers we did retrieve.
  const sourceGap = complete === false || failed.length > 0;
  const degraded = sourceGap || bounded === true;

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
            <span className="font-medium">
              {sourceGap ? 'This search is incomplete.' : 'This count is a lower bound.'}
            </span>{' '}
            {/*
              Every reason that applies, not the first one. These were an
              if/else chain, so a search that both lost a source *and* dropped
              papers unexamined reported only the source — the reader was told
              one of two independent things that had gone wrong, and the
              rescue's shortfall is invisible everywhere else in the response.

              They are genuinely independent: a source gap is a hole in the
              corpus, a bounded rescue is a hole in what was asked about the
              papers that did arrive. Either can happen without the other, and
              on a broad query both usually do.
            */}
            {sourceGap && (
              <>
                {failed.length > 0
                  ? `${failed.map(p => label(p.source)).join(', ')} did not answer`
                  : 'At least one source did not answer'}
                , so the count above is a lower bound — there are more matching papers
                than are shown.{' '}
              </>
            )}
            {bounded === true && (
              // Two spellings of one fact, because the first clause of the
              // original — "Every source answered, but…" — is a lie the moment
              // it appears beside a source that did not.
              <>
                {sourceGap ? 'Separately, not' : 'Every source answered, but not'} every paper
                could be checked for a retrievable copy — some were left out without being
                looked up, so there may be more open-access papers than are shown.
              </>
            )}
          </p>
        </div>
      )}

      {/*
        Not in the amber banner, deliberately. A truncated read is what a broad
        query normally does — it is true of nearly every search here — and
        putting a warning on the normal case is how a reader learns to stop
        reading warnings. The banner stays for the two things that actually went
        wrong. This is the fact that explains the number above it, and it sits
        beside the "not searched" line as a fact of the same kind.
      */}
      {coverageOf(providers).truncated && (
        <p className="mt-2 text-xs text-muted-foreground">
          Each source was read to a fixed depth, so the total above is what those reads held
          after de-duplication
          <span className="opacity-70"> — not everything that matches.</span>
        </p>
      )}

      {skipped.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Not searched for this query:{' '}
          {skipsByReason(providers).map(({ reason, sources }, index) => (
            <Fragment key={reason}>
              {index > 0 && '; '}
              {sources.map(label).join(', ')}
              <span className="opacity-70"> — {reason}</span>
            </Fragment>
          ))}
          <span className="opacity-70">.</span>
        </p>
      )}
    </div>
  );
}
