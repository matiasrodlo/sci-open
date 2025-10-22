'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Calendar, TrendingUp, User, BookOpen, FileText, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

type SortOption = 'relevance' | 'date' | 'date_asc' | 'citations' | 'citations_asc' | 'author' | 'author_desc' | 'venue' | 'venue_desc' | 'title' | 'title_desc';

export function SortBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = (searchParams.get('sort') as SortOption) || 'relevance';
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMoreOptions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const updateSort = (sort: SortOption) => {
    const params = new URLSearchParams(searchParams);
    if (sort === 'relevance') {
      params.delete('sort');
    } else {
      params.set('sort', sort);
    }
    router.push(`/results?${params.toString()}`);
    setShowMoreOptions(false);
  };

  // Primary sort options (always visible)
  const primarySortOptions = [
    { value: 'relevance' as const, label: 'Relevance', icon: ArrowUpDown, disabled: false },
    { value: 'date' as const, label: 'Date (Newest)', icon: Calendar, disabled: false },
    { value: 'citations' as const, label: 'Citations', icon: TrendingUp, disabled: true },
  ];

  // Additional sort options (in dropdown)
  const additionalSortOptions = [
    { value: 'date_asc' as const, label: 'Date (Oldest)', icon: Calendar, disabled: false },
    { value: 'citations_asc' as const, label: 'Citations (Lowest)', icon: TrendingUp, disabled: true },
    { value: 'author' as const, label: 'Author (A-Z)', icon: User, disabled: false },
    { value: 'author_desc' as const, label: 'Author (Z-A)', icon: User, disabled: false },
    { value: 'venue' as const, label: 'Venue (A-Z)', icon: BookOpen, disabled: false },
    { value: 'venue_desc' as const, label: 'Venue (Z-A)', icon: BookOpen, disabled: false },
    { value: 'title' as const, label: 'Title (A-Z)', icon: FileText, disabled: false },
    { value: 'title_desc' as const, label: 'Title (Z-A)', icon: FileText, disabled: false },
  ];

  const getCurrentSortLabel = () => {
    const allOptions = [...primarySortOptions, ...additionalSortOptions];
    const current = allOptions.find(option => option.value === currentSort);
    return current?.label || 'Relevance';
  };

  return (
    <div className="flex items-center gap-3 pb-4 border-b">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">Sort:</span>
      <div className="flex gap-2">
        {/* Primary sort options */}
        {primarySortOptions.map((option) => (
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
        
        {/* More options dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            className={`text-sm px-3 py-1 rounded transition-colors flex items-center gap-1 ${
              additionalSortOptions.some(opt => opt.value === currentSort)
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            More
            <ChevronDown className={`w-3 h-3 transition-transform ${showMoreOptions ? 'rotate-180' : ''}`} />
          </button>
          
          {showMoreOptions && (
            <div className="absolute top-full left-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 min-w-[200px]">
              {additionalSortOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => !option.disabled && updateSort(option.value)}
                  disabled={option.disabled}
                  className={`w-full text-left text-sm px-3 py-2 transition-colors flex items-center gap-2 ${
                    currentSort === option.value
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  } ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''} ${
                    option.value === additionalSortOptions[0].value ? 'rounded-t-md' : ''
                  } ${
                    option.value === additionalSortOptions[additionalSortOptions.length - 1].value ? 'rounded-b-md' : ''
                  }`}
                  title={option.disabled ? 'Citation data not yet available' : undefined}
                >
                  <option.icon className="w-4 h-4" />
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
