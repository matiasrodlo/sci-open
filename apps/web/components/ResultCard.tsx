'use client';

import { useState } from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { OARecord } from '@open-access-explorer/shared';
import { getPaper } from '@/lib/fetcher';

interface ResultCardProps {
  record: OARecord;
}

export function ResultCard({ record }: ResultCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    
    try {
      const response = await getPaper(record.id);
      if (response.pdf.url) {
        window.open(response.pdf.url, '_blank');
      } else {
        setDownloadError('PDF not available');
      }
    } catch (error) {
      setDownloadError('Failed to fetch PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  const getSourceBadge = (source: string) => {
    const colors = {
      arxiv: 'bg-orange-100 text-orange-800',
      core: 'bg-blue-100 text-blue-800',
      europepmc: 'bg-green-100 text-green-800',
      ncbi: 'bg-purple-100 text-purple-800',
    };
    return colors[source as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getOAStatusBadge = (status?: string) => {
    const colors = {
      preprint: 'bg-yellow-100 text-yellow-800',
      accepted: 'bg-blue-100 text-blue-800',
      published: 'bg-green-100 text-green-800',
      other: 'bg-gray-100 text-gray-800',
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold leading-tight mb-2 line-clamp-2">
              {record.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-2">
              {record.authors.slice(0, 3).map((author, index) => (
                <span key={index}>
                  {author}
                  {index < Math.min(record.authors.length, 3) - 1 && ', '}
                </span>
              ))}
              {record.authors.length > 3 && (
                <span>et al.</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {record.venue && (
                <span className="font-medium">{record.venue}</span>
              )}
              {record.year && (
                <span>• {record.year}</span>
              )}
              {record.doi && (
                <span>• DOI: {record.doi}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSourceBadge(record.source)}`}>
                {record.source.toUpperCase()}
              </span>
              {record.oaStatus && (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getOAStatusBadge(record.oaStatus)}`}>
                  {record.oaStatus}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="h-8"
            >
              {isDownloading ? (
                <FileText className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {record.abstract && (
          <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
            {record.abstract}
          </p>
        )}
        {record.topics && record.topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {record.topics.slice(0, 5).map((topic, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs"
              >
                {topic}
              </span>
            ))}
            {record.topics.length > 5 && (
              <span className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs">
                +{record.topics.length - 5} more
              </span>
            )}
          </div>
        )}
        {downloadError && (
          <p className="text-sm text-destructive mt-2">{downloadError}</p>
        )}
        {record.landingPage && (
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(record.landingPage, '_blank')}
              className="h-8 text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Source
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
