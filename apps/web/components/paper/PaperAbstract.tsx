'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface PaperAbstractProps {
  abstract?: string;
}

export function PaperAbstract({ abstract }: PaperAbstractProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!abstract) {
    return (
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Abstract</h2>
        <p className="text-sm italic text-muted-foreground">
          No abstract available for this paper.
        </p>
      </section>
    );
  }

  const isLongAbstract = abstract.length > 500;
  const displayText = isExpanded || !isLongAbstract 
    ? abstract 
    : abstract.slice(0, 500) + '...';

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Abstract</h2>
      <div className="space-y-3">
        <p className="max-w-[70ch] whitespace-pre-line text-[15px] leading-7 text-foreground/85">
          {displayText}
        </p>
        
        {isLongAbstract && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
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
    </section>
  );
}

