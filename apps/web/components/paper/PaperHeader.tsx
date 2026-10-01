import type { Paper } from '@open-access-explorer/shared';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Byline } from '@/components/Byline';
import { externalHref } from '@/lib/external-link';
import { accessRoute, landingLabel, notableStage } from '@/lib/access';

interface PaperHeaderProps {
  paper: Paper;
}

/** Authors named in the header before the rest are "et al.". */
const AUTHORS_SHOWN = 10;

export function PaperHeader({ paper }: PaperHeaderProps) {
  const route = accessRoute(paper.oaStatus);
  const stage = notableStage(paper.stage);
  const landingPage = externalHref(paper.landingPage);

  return (
    <header className="space-y-4 border-b pb-8">
      {/* How it is open and which version it is, above the title where
          OpenAlex names a work's type. The first of these read "Open Access"
          whenever the record had a version, because version 1 kept the
          version in the field named for the route. */}
      {(route || stage) && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {route && (
            <span className="text-green-700 dark:text-green-400" title={route.note}>
              {route.label}
            </span>
          )}
          {route && stage && <span aria-hidden="true">·</span>}
          {stage && <span>{stage}</span>}
        </div>
      )}

      <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-foreground md:text-4xl">
        {paper.title}
      </h1>

      <p className="text-[15px] leading-relaxed text-foreground/80 empty:hidden">
        <Byline year={paper.year} authors={paper.authors ?? []} venue={paper.venue} shown={AUTHORS_SHOWN} />
      </p>

      {/* The identifiers and counts, as the quiet row under a byline. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {paper.citationCount !== undefined && paper.citationCount > 0 && (
          <span>
            Cited by <span className="font-semibold text-foreground">{paper.citationCount.toLocaleString()}</span>
          </span>
        )}
        {paper.doi && (
          <span className="font-mono text-xs">{paper.doi}</span>
        )}
        {paper.language && paper.language !== 'en' && (
          <span className="rounded-md border px-1.5 py-0.5 text-xs font-medium">
            {paper.language.toUpperCase()}
          </span>
        )}
        {/* Screened the same way `openExternal` screens a click target: React
            renders a `javascript:` href with a warning rather than refusing
            it, and this URL comes from provider metadata.

            Named for where it goes. It said "View on" the provider that
            returned the record, which is often not where the page is:
            OpenAlex records a DOI link, which leads to the publisher. */}
        {landingPage && (
          <Link
            href={landingPage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            {landingLabel(landingPage)}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </header>
  );
}
