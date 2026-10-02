import type { SearchProgress } from '@open-access-explorer/core';
import type { ToolDeps } from '../framework/define-tool';

const SETTLED: Record<string, string> = { ok: 'answered', timeout: 'timed out', error: 'failed', skipped: 'skipped' };

/**
 * Engine progress as the messages a client shows. The sources carry a total,
 * since the plan fixes how many there are; the two steps after them do not,
 * since whether the access check runs is only known when it starts.
 */
export function searchProgress(deps: Pick<ToolDeps, 'progress'>): (event: SearchProgress) => void {
  return event => {
    switch (event.stage) {
      case 'sources': {
        const { provider, status, rateLimited } = event.report;
        const what = rateLimited ? 'is rate-limited' : (SETTLED[status] ?? status);
        deps.progress(`${provider} ${what} (${event.settled} of ${event.planned} sources)`, event.planned);
        return;
      }
      case 'access':
        deps.progress(`Checking for free copies of ${event.candidates} papers no source called open`);
        return;
      case 'details':
        deps.progress(`Filling in details for ${event.papers} papers`);
    }
  };
}
