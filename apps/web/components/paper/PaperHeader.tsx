import { OARecord } from '@open-access-explorer/shared';
import { ExternalLink, Calendar, Users, BookOpen, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

interface PaperHeaderProps {
  paper: OARecord;
}

const getSourceColor = (source: string) => {
  const colors: Record<string, string> = {
    arxiv: 'bg-red-100 text-red-800 hover:bg-red-200',
    core: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
    europepmc: 'bg-green-100 text-green-800 hover:bg-green-200',
    ncbi: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
    openaire: 'bg-orange-100 text-orange-800 hover:bg-orange-200',
    biorxiv: 'bg-teal-100 text-teal-800 hover:bg-teal-200',
    medrxiv: 'bg-cyan-100 text-cyan-800 hover:bg-cyan-200',
    doaj: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  };
  return colors[source] || 'bg-gray-100 text-gray-800 hover:bg-gray-200';
};

const getOAStatusColor = (status?: string) => {
  const colors: Record<string, string> = {
    preprint: 'bg-yellow-100 text-yellow-800',
    accepted: 'bg-blue-100 text-blue-800',
    published: 'bg-green-100 text-green-800',
    other: 'bg-gray-100 text-gray-800',
  };
  return colors[status || 'other'] || 'bg-gray-100 text-gray-800';
};

export function PaperHeader({ paper }: PaperHeaderProps) {
  return (
    <div className="bg-card border-b pb-8 space-y-5">
      {/* Source and OA Status Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs font-medium border-muted-foreground/20">
          {paper.source.toUpperCase()}
        </Badge>
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

      {/* Venue and Year */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {paper.venue && (
          <span className="italic">{paper.venue}</span>
        )}
        {paper.year && (
          <span className="font-medium">({paper.year})</span>
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

