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
      // If we already have a PDF URL, use it directly
      if (record.bestPdfUrl) {
        window.open(record.bestPdfUrl, '_blank');
        setIsDownloading(false);
        return;
      }
      
      // Otherwise, try to resolve it via the API
      const response = await getPaper(record.id);
      if (response.pdf.url) {
        window.open(response.pdf.url, '_blank');
      } else {
        setDownloadError('PDF not available');
      }
    } catch (error) {
      console.error('PDF download error:', error);
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
      doaj: 'bg-emerald-100 text-emerald-800',
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
    <Card className="group hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 border-2 hover:border-primary/20 bg-gradient-to-br from-card to-card/50">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 space-y-3">
            <h3 className="text-xl font-bold leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-200">
              {record.title}
            </h3>
            
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {record.authors.slice(0, 3).map((author, index) => (
                <span key={index} className="text-foreground font-medium">
                  {author}
                  {index < Math.min(record.authors.length, 3) - 1 && ', '}
                </span>
              ))}
              {record.authors.length > 3 && (
                <span className="text-muted-foreground">et al.</span>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {record.venue && (
                <span className="font-medium text-foreground bg-muted/50 px-2 py-1 rounded-md">
                  {record.venue}
                </span>
              )}
              {record.year && (
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {record.year}
                </span>
              )}
              {record.doi && (
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  DOI
                </span>
              )}
            </div>
          </div>
          
          <div className="flex flex-col gap-3 items-end">
            <div className="flex gap-2">
              <span className={`px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm ${getSourceBadge(record.source)}`}>
                {record.source.toUpperCase()}
              </span>
              {record.oaStatus && (
                <span className={`px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm ${getOAStatusBadge(record.oaStatus)}`}>
                  {record.oaStatus}
                </span>
              )}
            </div>
            
            {record.bestPdfUrl ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
                className="h-9 px-4 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all duration-200"
              >
                {isDownloading ? (
                  <FileText className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                PDF
              </Button>
            ) : (
              <div className="text-xs text-muted-foreground text-center px-3 py-2 bg-muted/50 rounded-md">
                PDF not available
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-4">
        {record.abstract && (
          <div className="relative">
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
              {record.abstract}
            </p>
            <div className="absolute bottom-0 right-0 bg-gradient-to-l from-card to-transparent w-8 h-6" />
          </div>
        )}
        
        {record.topics && record.topics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {record.topics.slice(0, 6).map((topic, index) => (
              <span
                key={index}
                className="px-3 py-1.5 bg-gradient-to-r from-secondary to-secondary/80 text-secondary-foreground rounded-full text-xs font-medium shadow-sm hover:shadow-md transition-shadow duration-200"
              >
                {topic}
              </span>
            ))}
            {record.topics.length > 6 && (
              <span className="px-3 py-1.5 bg-muted text-muted-foreground rounded-full text-xs font-medium">
                +{record.topics.length - 6} more
              </span>
            )}
          </div>
        )}
        
        {downloadError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive font-medium">{downloadError}</p>
          </div>
        )}
        
        {record.landingPage && (
          <div className="flex justify-between items-center pt-2 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(record.landingPage, '_blank')}
              className="h-8 text-xs hover:bg-primary/10 hover:text-primary transition-colors duration-200"
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              View Source
            </Button>
            
            {record.doi && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`https://doi.org/${record.doi}`, '_blank')}
                className="h-8 text-xs hover:bg-primary/10 hover:text-primary transition-colors duration-200"
              >
                <svg className="h-3 w-3 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                DOI
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
