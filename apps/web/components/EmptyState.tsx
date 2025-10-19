import { Search, FileX } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  type: 'no-results' | 'no-query';
  onNewSearch?: () => void;
}

export function EmptyState({ type, onNewSearch }: EmptyStateProps) {
  if (type === 'no-query') {
    return (
      <div className="text-center py-12">
        <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Start your search</h3>
        <p className="text-muted-foreground mb-4">
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
    <div className="text-center py-12">
      <FileX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="text-lg font-semibold mb-2">No results found</h3>
      <p className="text-muted-foreground mb-4">
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
