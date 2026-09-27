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
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Publication Details
      </h3>
      <div className="space-y-4 text-sm">

        {/* DOI */}
        {paper.doi && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">DOI</div>
            <a 
              href={`https://doi.org/${paper.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline break-all"
            >
              {paper.doi}
            </a>
          </div>
        )}

        {/* Publication Year */}
        {paper.year && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Publication Year</div>
            <div className="text-sm text-foreground">{paper.year}</div>
          </div>
        )}

        {/* Language */}
        {paper.language && paper.language !== 'en' && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Language</div>
            <div className="text-sm text-foreground capitalize">{paper.language}</div>
          </div>
        )}

        {/* Version. This row was "Access Status" and printed `published`
            or `preprint`: the version, under the route's name. */}
        {stage && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Version</div>
            <div className="text-sm text-foreground">{stage}</div>
          </div>
        )}

        {/* Open-access route */}
        {route && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Open Access</div>
            <div className="text-sm text-foreground">{route.label}</div>
            <div className="text-xs text-muted-foreground">{route.note}</div>
          </div>
        )}

        {/* The copy, and whether anyone has looked at it */}
        {paper.fullText && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Full Text</div>
            <div className="text-sm text-foreground">{copyNote(paper.fullText)}</div>
          </div>
        )}

        {/* Who the record came from. A click from the results carries every
            source the search merged; the page's own lookup asks the one
            provider the id belongs to, and replaces it with that. */}
        {sources.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Record From</div>
            <div className="text-sm text-foreground">{sources.join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

