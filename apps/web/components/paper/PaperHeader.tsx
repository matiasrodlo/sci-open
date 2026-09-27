import type { Paper } from '@open-access-explorer/shared';
import { ExternalLink, Quote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { externalHref } from '@/lib/external-link';
import { accessRoute, landingLabel, notableStage } from '@/lib/access';

interface PaperHeaderProps {
  paper: Paper;
}

export function PaperHeader({ paper }: PaperHeaderProps) {
  const route = accessRoute(paper.oaStatus);
  const stage = notableStage(paper.stage);
  const landingPage = externalHref(paper.landingPage);

  return (
    <div className="bg-card border-b pb-8 space-y-5">
      {/* How it is open, which version it is, and the DOI. The first badge
          read "Open Access" whenever the record had a version, because
          version 1 kept the version in the field named for the route. */}
      <div className="flex items-center gap-2 flex-wrap">
        {route && (
          <Badge
            variant="outline"
            className="text-xs font-medium border-green-500/20 text-green-700 dark:text-green-400"
            title={route.note}
          >
            {route.label}
          </Badge>
        )}
        {stage && (
          <Badge variant="outline" className="text-xs font-medium border-muted-foreground/20">
            {stage}
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

      {/* Landing Page Link. Screened the same way `openExternal` screens a
          click target: React renders a `javascript:` href with a warning rather
          than refusing it, and this URL comes from provider metadata.

          Named for where it goes. It said "View on" the provider that returned
          the record, which is often not where the page is: OpenAlex records a
          DOI link, which leads to the publisher. */}
      {landingPage && (
        <div className="pt-2">
          <Link 
            href={landingPage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {landingLabel(landingPage)}
          </Link>
        </div>
      )}
    </div>
  );
}

