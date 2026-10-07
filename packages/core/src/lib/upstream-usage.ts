import { AsyncLocalStorage } from 'async_hooks';

/**
 * What this process asked of the sources, source by source: every request
 * sent — each retry is one — and the ones that failed or were refused for a
 * rate limit. Every source is free; what they limit is how often they may be
 * asked, so the count is what there is to watch.
 *
 * Counted where every request leaves: the pooled clients' response
 * interceptor (`http-client-factory.ts`) and the full-text proxy's guarded GET.
 */
export type SourceUsage = { requests: number; failed: number; rateLimited: number };

export type UpstreamUsage = {
  requests: number;
  sources: Record<string, SourceUsage>;
};

/** The source each upstream host serves. */
const HOSTS: Readonly<Record<string, string>> = {
  'export.arxiv.org': 'arxiv',
  'arxiv.org': 'arxiv',
  'api.biorxiv.org': 'biorxiv',
  'api.core.ac.uk': 'core',
  'api.crossref.org': 'crossref',
  'api.datacite.org': 'datacite',
  'doaj.org': 'doaj',
  'www.ebi.ac.uk': 'europepmc',
  'eutils.ncbi.nlm.nih.gov': 'ncbi',
  'api.openaire.eu': 'openaire',
  'api.opencitations.net': 'opencitations',
  'opencitations.net': 'opencitations',
  'api.plos.org': 'plos',
  'api.unpaywall.org': 'unpaywall',
  'doi.org': 'doi.org'
};

/** A known source's name; any other host is a publisher or repository read
 * for a full text, and is counted as `full-text` rather than by name. */
export function sourceOf(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    return HOSTS[new URL(url).hostname.toLowerCase()] ?? 'full-text';
  } catch {
    return 'unknown';
  }
}

class Tally {
  private readonly sources = new Map<string, SourceUsage>();

  add(source: string, outcome: { status?: number }): void {
    let usage = this.sources.get(source);
    if (!usage) this.sources.set(source, (usage = { requests: 0, failed: 0, rateLimited: 0 }));
    usage.requests++;
    if (outcome.status === undefined || outcome.status >= 400) usage.failed++;
    if (outcome.status === 429) usage.rateLimited++;
  }

  snapshot(): UpstreamUsage {
    const sources = Object.fromEntries([...this.sources].map(([name, usage]) => [name, { ...usage }]));
    return { requests: [...this.sources.values()].reduce((n, u) => n + u.requests, 0), sources };
  }
}

const sinceStart = new Tally();
const perCall = new AsyncLocalStorage<Tally>();

/**
 * One request that reached a source, or failed on the way (`status`
 * undefined). Counted for the process, and for the measured call it was made
 * in, if any. A request made by work shared through a `SingleFlight` is the
 * call's that started it: a call that only joined cost the sources nothing.
 */
export function recordUpstream(url: string | undefined, outcome: { status?: number }): void {
  const source = sourceOf(url);
  sinceStart.add(source, outcome);
  perCall.getStore()?.add(source, outcome);
}

/** Everything asked of the sources since the process started. */
export function upstreamUsage(): UpstreamUsage {
  return sinceStart.snapshot();
}

/** What was asked between `base`, an earlier `upstreamUsage()`, and `now`. */
export function usageSince(now: UpstreamUsage, base: UpstreamUsage): UpstreamUsage {
  const sources: Record<string, SourceUsage> = {};
  for (const [name, usage] of Object.entries(now.sources)) {
    const before = base.sources[name] ?? { requests: 0, failed: 0, rateLimited: 0 };
    if (usage.requests === before.requests) continue;
    sources[name] = {
      requests: usage.requests - before.requests,
      failed: usage.failed - before.failed,
      rateLimited: usage.rateLimited - before.rateLimited
    };
  }
  return { requests: now.requests - base.requests, sources };
}

/**
 * Runs `work` with its own tally: `usage()` says what it asked of the sources,
 * however it ended. Requests it set going that outlive it — a facet count
 * still running when its search returned — are counted when they land.
 */
export function measureUpstream<T>(work: () => Promise<T>): { done: Promise<T>; usage: () => UpstreamUsage } {
  const tally = new Tally();
  return { done: perCall.run(tally, work), usage: () => tally.snapshot() };
}
