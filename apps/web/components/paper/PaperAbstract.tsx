'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';

interface PaperAbstractProps {
  abstract?: string;
}

export function PaperAbstract({ abstract }: PaperAbstractProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!abstract) {
    return (
      <div className="pt-2 mt-2">
        <h2 className="text-lg font-semibold mb-4">Abstract</h2>
        <p className="text-sm text-muted-foreground italic">
          No abstract available for this paper.
        </p>
      </div>
    );
  }

  const isLongAbstract = abstract.length > 500;
  const displayText = isExpanded || !isLongAbstract 
    ? abstract 
    : abstract.slice(0, 500) + '...';

  return (
    <div className="pt-2 mt-2">
      <h2 className="text-lg font-semibold mb-4">Abstract</h2>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
          {displayText}
        </p>
        
        {isLongAbstract && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show More
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

