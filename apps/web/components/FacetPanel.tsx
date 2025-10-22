'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';

interface FacetPanelProps {
  facets: Record<string, any>;
  currentFilters: {
    sources: string[];
    yearFrom?: number;
    yearTo?: number;
  };
}

export function FacetPanel({ facets, currentFilters }: FacetPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilters = (newFilters: any) => {
    const params = new URLSearchParams(searchParams);
    
    Object.entries(newFilters).forEach(([key, value]) => {
      if (value && (Array.isArray(value) ? value.length > 0 : true)) {
        if (Array.isArray(value)) {
          params.set(key, value.join(','));
        } else {
          params.set(key, value.toString());
        }
      } else {
        params.delete(key);
      }
    });

    router.push(`/results?${params.toString()}`);
  };

  const toggleSource = (source: string) => {
    const newSources = currentFilters.sources.includes(source)
      ? currentFilters.sources.filter(s => s !== source)
      : [...currentFilters.sources, source];
    
    updateFilters({ sources: newSources });
  };

  const getSourceLabel = (source: string) => {
    const labels = {
      arxiv: 'arXiv',
      core: 'CORE',
      europepmc: 'Europe PMC',
      ncbi: 'NCBI/PMC',
    };
    return labels[source as keyof typeof labels] || source;
  };

  const getOAStatusLabel = (status: string) => {
    const labels = {
      preprint: 'Preprint',
      accepted: 'Author Accepted',
      published: 'Published',
      other: 'Other',
    };
    return labels[status as keyof typeof labels] || status;
  };

  const getPublisherLabel = (publisher: string) => {
    // Common publisher name mappings for better display
    const labels: Record<string, string> = {
      'Springer Nature': 'Springer Nature',
      'Elsevier': 'Elsevier',
      'Wiley': 'Wiley',
      'IEEE': 'IEEE',
      'ACM': 'ACM',
      'PLOS': 'PLOS',
      'MDPI': 'MDPI',
      'Frontiers': 'Frontiers',
      'BioMed Central': 'BioMed Central',
      'Nature Publishing Group': 'Nature',
      'Oxford University Press': 'Oxford UP',
      'Cambridge University Press': 'Cambridge UP',
    };
    return labels[publisher] || publisher;
  };

  return (
    <div className="space-y-6">
      {/* Years */}
      {facets.year && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Year
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.year)
              .sort(([a], [b]) => parseInt(b) - parseInt(a))
              .slice(0, 10)
              .map(([year, count]) => (
                <div key={year} className="flex items-center space-x-2">
                  <Checkbox
                    id={`year-${year}`}
                    checked={searchParams.get('year')?.split(',').includes(year) || false}
                    onCheckedChange={(checked) => {
                      const current = searchParams.get('year')?.split(',') || [];
                      const newYears = checked
                        ? [...current, year]
                        : current.filter(y => y !== year);
                      updateFilters({ year: newYears });
                    }}
                  />
                  <label
                    htmlFor={`year-${year}`}
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                  >
                    {year}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {count as number}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Venues */}
      {facets.venue && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Venue
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.venue)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 10)
              .map(([venue, count]) => (
                <div key={venue} className="flex items-center space-x-2">
                  <Checkbox
                    id={`venue-${venue}`}
                    checked={searchParams.get('venue')?.split(',').includes(venue) || false}
                    onCheckedChange={(checked) => {
                      const current = searchParams.get('venue')?.split(',') || [];
                      const newVenues = checked
                        ? [...current, venue]
                        : current.filter(v => v !== venue);
                      updateFilters({ venue: newVenues });
                    }}
                  />
                  <label
                    htmlFor={`venue-${venue}`}
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                    title={venue}
                  >
                    {venue}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {count as number}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Publishers */}
      {facets.publisher && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Publisher
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.publisher)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 10)
              .map(([publisher, count]) => (
                <div key={publisher} className="flex items-center space-x-2">
                  <Checkbox
                    id={`publisher-${publisher}`}
                    checked={searchParams.get('publisher')?.split(',').includes(publisher) || false}
                    onCheckedChange={(checked) => {
                      const current = searchParams.get('publisher')?.split(',') || [];
                      const newPublishers = checked
                        ? [...current, publisher]
                        : current.filter(p => p !== publisher);
                      updateFilters({ publisher: newPublishers });
                    }}
                  />
                  <label
                    htmlFor={`publisher-${publisher}`}
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                    title={publisher}
                  >
                    {getPublisherLabel(publisher)}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {count as number}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Topics */}
      {facets.topics && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Topics
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.topics)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 15)
              .map(([topic, count]) => (
                <div key={topic} className="flex items-center space-x-2">
                  <Checkbox
                    id={`topic-${topic}`}
                    checked={searchParams.get('topics')?.split(',').includes(topic) || false}
                    onCheckedChange={(checked) => {
                      const current = searchParams.get('topics')?.split(',') || [];
                      const newTopics = checked
                        ? [...current, topic]
                        : current.filter(t => t !== topic);
                      updateFilters({ topics: newTopics });
                    }}
                  />
                  <label
                    htmlFor={`topic-${topic}`}
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                    title={topic}
                  >
                    {topic}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {count as number}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
