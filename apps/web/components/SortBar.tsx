'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Calendar, TrendingUp } from 'lucide-react';

type SortOption = 'relevance' | 'date' | 'citations';

export function SortBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = (searchParams.get('sort') as SortOption) || 'relevance';

  const updateSort = (sort: SortOption) => {
    const params = new URLSearchParams(searchParams);
    if (sort === 'relevance') {
      params.delete('sort');
    } else {
      params.set('sort', sort);
    }
    router.push(`/results?${params.toString()}`);
  };

  const sortOptions = [
    { value: 'relevance' as const, label: 'Relevance', icon: ArrowUpDown, disabled: false },
    { value: 'date' as const, label: 'Date', icon: Calendar, disabled: false },
    { value: 'citations' as const, label: 'Citations', icon: TrendingUp, disabled: true },
  ];

  return (
    <div className="flex items-center gap-3 pb-4 border-b">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">Sort:</span>
      <div className="flex gap-2">
        {sortOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => !option.disabled && updateSort(option.value)}
            disabled={option.disabled}
            className={`text-sm px-3 py-1 rounded transition-colors ${
              currentSort === option.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            } ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={option.disabled ? 'Citation data not yet available' : undefined}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
