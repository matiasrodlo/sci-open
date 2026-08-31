import { OARecord } from '@open-access-explorer/shared';

interface PaperMetadataProps {
  paper: OARecord;
}

export function PaperMetadata({ paper }: PaperMetadataProps) {

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

        {/* Open Access Status */}
        {paper.oaStatus && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Access Status</div>
            <div className="text-sm text-foreground capitalize">{paper.oaStatus}</div>
          </div>
        )}
      </div>
    </div>
  );
}

