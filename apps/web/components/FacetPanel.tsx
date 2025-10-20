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

  return (
    <div className="space-y-6">
      {/* Sources */}
      {facets.source && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Sources
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.source).map(([source, count]) => (
              <div key={source} className="flex items-center space-x-2">
                <Checkbox
                  id={`source-${source}`}
                  checked={currentFilters.sources.includes(source)}
                  onCheckedChange={() => toggleSource(source)}
                />
                <label
                  htmlFor={`source-${source}`}
                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                >
                  {getSourceLabel(source)}
                </label>
                <span className="text-xs text-muted-foreground">
                  {count as number}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Access Status */}
      {facets.oaStatus && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Access Type
          </h3>
          <div className="space-y-2">
            {Object.entries(facets.oaStatus).map(([status, count]) => (
              <div key={status} className="flex items-center space-x-2">
                <Checkbox
                  id={`oa-${status}`}
                  checked={searchParams.get('oaStatus')?.split(',').includes(status) || false}
                  onCheckedChange={(checked) => {
                    const current = searchParams.get('oaStatus')?.split(',') || [];
                    const newStatus = checked
                      ? [...current, status]
                      : current.filter(s => s !== status);
                    updateFilters({ oaStatus: newStatus });
                  }}
                />
                <label
                  htmlFor={`oa-${status}`}
                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                >
                  {getOAStatusLabel(status)}
                </label>
                <span className="text-xs text-muted-foreground">
                  {count as number}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
