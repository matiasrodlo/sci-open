import { OARecord } from '@open-access-explorer/shared';
import { ExternalLink, Quote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

interface PaperHeaderProps {
  paper: OARecord;
}

export function PaperHeader({ paper }: PaperHeaderProps) {
  return (
    <div className="bg-card border-b pb-8 space-y-5">
      {/* OA Status and DOI Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {paper.oaStatus && (
          <Badge variant="outline" className="text-xs font-medium border-green-500/20 text-green-700 dark:text-green-400">
            Open Access
          </Badge>
        )}
        {paper.doi && (
          <Badge variant="outline" className="font-mono text-xs border-muted-foreground/20 text-muted-foreground">
            {paper.doi}
          </Badge>
        )}
      </div>

      {/* Title */}
      <h1 className="text-3xl md:text-4xl font-semibold leading-tight text-foreground tracking-tight">
        {paper.title}
      </h1>

      {/* Authors */}
      {paper.authors && paper.authors.length > 0 && (
        <div className="text-base text-foreground">
          {paper.authors.slice(0, 10).join('; ')}
          {paper.authors.length > 10 && <span className="text-muted-foreground"> et al.</span>}
        </div>
      )}

      {/* Venue, Year, and Citations */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {paper.venue && (
          <span className="italic">{paper.venue}</span>
        )}
        {paper.year && (
          <span className="font-medium">({paper.year})</span>
        )}
        {paper.citationCount !== undefined && paper.citationCount > 0 && (
          <div className="flex items-center gap-1.5">
            <Quote className="h-4 w-4" />
            <span className="font-medium">{paper.citationCount.toLocaleString()}</span>
            <span className="text-xs">
              {paper.citationCount === 1 ? 'citation' : 'citations'}
            </span>
          </div>
        )}
        {paper.language && paper.language !== 'en' && (
          <Badge variant="outline" className="text-xs border-muted-foreground/20">
            {paper.language.toUpperCase()}
          </Badge>
        )}
      </div>

      {/* Topics/Keywords */}
      {paper.topics && paper.topics.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {paper.topics.slice(0, 8).map((topic, idx) => (
            <span 
              key={idx} 
              className="text-xs px-2.5 py-1 bg-muted/50 text-muted-foreground rounded-md"
            >
              {topic}
            </span>
          ))}
          {paper.topics.length > 8 && (
            <span className="text-xs px-2.5 py-1 bg-muted/50 text-muted-foreground rounded-md">
              +{paper.topics.length - 8} more
            </span>
          )}
        </div>
      )}

      {/* Landing Page Link */}
      {paper.landingPage && (
        <div className="pt-2">
          <Link 
            href={paper.landingPage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on {paper.source.toUpperCase()}
          </Link>
        </div>
      )}
    </div>
  );
}

