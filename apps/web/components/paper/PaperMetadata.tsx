import type { Paper } from '@open-access-explorer/shared';
import { accessRoute, copyNote, foundIn, stageLabel } from '@/lib/access';

interface PaperMetadataProps {
  paper: Paper;
}

export function PaperMetadata({ paper }: PaperMetadataProps) {
  const route = accessRoute(paper.oaStatus);
  const stage = stageLabel(paper.stage);
  const sources = foundIn(paper);

  return (
    <div className="rounded-lg border bg-subtle p-4">
      <h3 className="text-[13px] font-semibold">
        Publication Details
      </h3>
      <div className="mt-4 space-y-4 text-sm">

        {/* DOI */}
        {paper.doi && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">DOI</div>
            <a 
              href={`https://doi.org/${paper.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-[13px] text-link hover:underline"
            >
              {paper.doi}
            </a>
          </div>
        )}

        {/* Publication Year */}
        {paper.year && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Publication Year</div>
            <div className="text-sm text-foreground">{paper.year}</div>
          </div>
        )}

        {/* Language */}
        {paper.language && paper.language !== 'en' && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Language</div>
            <div className="text-sm text-foreground capitalize">{paper.language}</div>
          </div>
        )}

        {/* Version. This row was "Access Status" and printed `published`
            or `preprint`: the version, under the route's name. */}
        {stage && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Version</div>
            <div className="text-sm text-foreground">{stage}</div>
          </div>
        )}

        {/* Open-access route */}
        {route && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Open Access</div>
            <div className="text-sm text-foreground">{route.label}</div>
            <div className="text-xs text-muted-foreground">{route.note}</div>
          </div>
        )}

        {/* The copy, and whether anyone has looked at it */}
        {paper.fullText && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Full Text</div>
            <div className="text-sm text-foreground">{copyNote(paper.fullText)}</div>
          </div>
        )}

        {/* Who the record came from. A click from the results carries every
            source the search merged; the page's own lookup asks the one
            provider the id belongs to, and replaces it with that. */}
        {sources.length > 0 && (
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Record From</div>
            <div className="text-sm text-foreground">{sources.join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

