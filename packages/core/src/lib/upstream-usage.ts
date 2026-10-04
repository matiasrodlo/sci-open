import { AsyncLocalStorage } from 'async_hooks';

/**
 * What this process asked of the sources, source by source: every request
 * sent — each retry is one — the ones that failed or were refused for a rate
 * limit, and what OpenAlex says they cost.
 *
 * OpenAlex meters a key by a daily budget in dollars and answers 429 once it
 * is spent (D13). Without this the budget ran out after "a few runs", with
 * nothing to say which tool, search or step had spent it. Every response
 * OpenAlex sends carries its own price, `meta.cost_usd`, so the cost is summed
 * rather than estimated.
 *
 * Counted where every request leaves: the pooled clients' response
 * interceptor (`http-client-factory.ts`) and the full-text proxy's guarded GET.
 */
export type SourceUsage = { requests: number; failed: number; rateLimited: number; costUsd: number };

export type UpstreamUsage = {
  requests: number;
  /** OpenAlex's own price for what was asked of it, in dollars. */
  costUsd: number;
  sources: Record<string, SourceUsage>;
};

/** The source each upstream host serves. */
const HOSTS: Readonly<Record<string, string>> = {
  'api.openalex.org': 'openalex',
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

  add(source: string, outcome: { status?: number; costUsd?: number }): void {
    let usage = this.sources.get(source);
    if (!usage) this.sources.set(source, (usage = { requests: 0, failed: 0, rateLimited: 0, costUsd: 0 }));
    usage.requests++;
    if (outcome.status === undefined || outcome.status >= 400) usage.failed++;
    if (outcome.status === 429) usage.rateLimited++;
    if (outcome.costUsd !== undefined) usage.costUsd += outcome.costUsd;
  }

  snapshot(): UpstreamUsage {
    const sources = Object.fromEntries([...this.sources].map(([name, usage]) => [name, { ...usage }]));
    const all = [...this.sources.values()];
    return {
      requests: all.reduce((n, u) => n + u.requests, 0),
      costUsd: round(all.reduce((n, u) => n + u.costUsd, 0)),
      sources
    };
  }
}

/** Dollars to a millionth: OpenAlex prices a request at $0.0001 or $0.001,
 * and floating-point sums of those should not read $0.0021000000000000003. */
const round = (dollars: number) => Math.round(dollars * 1e6) / 1e6;

const sinceStart = new Tally();
const perCall = new AsyncLocalStorage<Tally>();

/**
 * One request that reached a source, or failed on the way (`status`
 * undefined). Counted for the process, and for the measured call it was made
 * in, if any. A request made by work shared through a `SingleFlight` is the
 * call's that started it: a call that only joined cost the sources nothing.
 */
export function recordUpstream(url: string | undefined, outcome: { status?: number; costUsd?: number }): void {
  const source = sourceOf(url);
  sinceStart.add(source, outcome);
  perCall.getStore()?.add(source, outcome);
}

/** OpenAlex's price for a response, from the `meta` it sends with every answer. */
export function costOf(body: unknown): number | undefined {
  const cost = (body as { meta?: { cost_usd?: unknown } } | undefined)?.meta?.cost_usd;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

/** Everything asked of the sources since the process started. */
export function upstreamUsage(): UpstreamUsage {
  return sinceStart.snapshot();
}

/** What was asked between `base`, an earlier `upstreamUsage()`, and `now`. */
export function usageSince(now: UpstreamUsage, base: UpstreamUsage): UpstreamUsage {
  const sources: Record<string, SourceUsage> = {};
  for (const [name, usage] of Object.entries(now.sources)) {
    const before = base.sources[name] ?? { requests: 0, failed: 0, rateLimited: 0, costUsd: 0 };
    if (usage.requests === before.requests) continue;
    sources[name] = {
      requests: usage.requests - before.requests,
      failed: usage.failed - before.failed,
      rateLimited: usage.rateLimited - before.rateLimited,
      costUsd: round(usage.costUsd - before.costUsd)
    };
  }
  return { requests: now.requests - base.requests, costUsd: round(now.costUsd - base.costUsd), sources };
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
