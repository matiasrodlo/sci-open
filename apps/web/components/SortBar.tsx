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
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Sort by:</span>
        <div className="flex gap-1">
          {sortOptions.map((option) => {
            const Icon = option.icon;
            return (
              <Button
                key={option.value}
                variant={currentSort === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => !option.disabled && updateSort(option.value)}
                disabled={option.disabled}
                className="h-8"
                title={option.disabled ? 'Citation data not yet available' : undefined}
              >
                <Icon className="h-3 w-3 mr-1" />
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
