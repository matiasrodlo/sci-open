import { Search, FileX } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  type: 'no-results' | 'no-query';
  onNewSearch?: () => void;
}

export function EmptyState({ type, onNewSearch }: EmptyStateProps) {
  if (type === 'no-query') {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="mb-1 text-lg font-semibold">Start your search</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Enter a DOI, title, or keywords to find open-access research papers
        </p>
        {onNewSearch && (
          <Button onClick={onNewSearch}>
            New Search
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FileX className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mb-1 text-lg font-semibold">No results found</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Try adjusting your search terms or filters to find more papers
      </p>
      {onNewSearch && (
        <Button onClick={onNewSearch}>
          New Search
        </Button>
      )}
    </div>
  );
}
