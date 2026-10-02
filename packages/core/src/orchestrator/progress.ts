import type { ProviderReport } from '@open-access-explorer/shared';

/**
 * What a search is doing, for a caller that shows it: each source as it
 * settles, then the two steps after the fan-out that can each take seconds. A
 * held set reports only `details`, since nothing was asked; a call that joins
 * a resolution already running (single-flight) sees only the steps it runs
 * itself.
 */
export type SearchProgress =
  | { stage: 'sources'; settled: number; planned: number; report: ProviderReport }
  | { stage: 'access'; candidates: number }
  | { stage: 'details'; papers: number };

/**
 * A listener, called and never awaited, whose failure is dropped: what a
 * caller does with progress must not be able to hurt the search it describes.
 */
export function progressTo(listener?: (event: SearchProgress) => void): (event: SearchProgress) => void {
  return event => {
    try {
      listener?.(event);
    } catch {
      // a listener's failure is not the search's
    }
  };
}
