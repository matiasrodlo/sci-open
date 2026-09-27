'use client';

import type { Paper } from '@open-access-explorer/shared';
import { WoSExportDialog } from './WoSExportDialog';

interface ExportButtonProps {
  results: Paper[];
  query: string;
  totalResults?: number;
  currentPage?: number;
  pageSize?: number;
}

export function ExportButton({ 
  results, 
  query, 
  totalResults = results.length, 
  currentPage = 1, 
  pageSize = results.length 
}: ExportButtonProps) {
  return (
    <WoSExportDialog
      results={results}
      query={query}
      totalResults={totalResults}
      currentPage={currentPage}
      pageSize={pageSize}
    />
  );
}