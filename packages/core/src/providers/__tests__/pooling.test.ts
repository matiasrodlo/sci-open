import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Every upstream is fetched through the pooled client.
 *
 * It used to be five of thirteen, and the eight left out were the search
 * fan-out — the expensive half, and the half that decides how long a search
 * takes. Europe PMC alone reads up to 600 records per query. Those eight opened
 * a fresh connection per request, ran without the retry policy, and contributed
 * nothing to `httpPerformanceMonitor`, so the three `/api/performance/*` routes
 * and the 30-second collection behind them described the five cheapest callers
 * and were silent about everything a slow search is made of.
 *
 * The split was deliberate and documented, which is exactly why it needed a
 * test rather than a comment: nothing failed while it drifted, and nothing
 * would have failed when the next connector was added beside the wrong half.
 * This asserts the property directly, over the files as they are on disk, so a
 * new `fetch.ts` is covered the day it is written.
 */

const ROOT = path.join(__dirname, '..', '..');

function fetchers(): Array<{ name: string; source: string }> {
  const found: Array<{ name: string; source: string }> = [];

  for (const group of ['providers', 'authorities']) {
    const dir = path.join(ROOT, group);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('__')) continue;
      const file = path.join(dir, entry.name, 'fetch.ts');
      if (!fs.existsSync(file)) continue;
      found.push({ name: `${group}/${entry.name}`, source: fs.readFileSync(file, 'utf8') });
    }
  }

  return found;
}

describe('every upstream is pooled', () => {
  const all = fetchers();

  it('finds every connector, so the assertions below cover the fan-out', () => {
    // A guard on the guard: if the layout changes and this stops finding
    // files, the per-file assertions would all vacuously pass.
    expect(all.length).toBeGreaterThanOrEqual(13);
    expect(all.map(f => f.name)).toContain('providers/europepmc');
    expect(all.map(f => f.name)).toContain('authorities/opencitations');
  });

  it.each(fetchers().map(f => [f.name, f.source] as const))(
    '%s pools its own requests or delegates to one that does',
    (_name, source) => {
      // `authorities/openalex` is the delegating case: it wraps
      // `providers/openalex/fetch`, which pools, and issues no request of its
      // own. Naming that shape here rather than exempting the file keeps a
      // third pattern from arriving unnoticed.
      const pools = source.includes('getPooledClient');
      const delegates = /from '\.\.\/\.\.\/providers\/[a-z]+\/fetch'/.test(source);

      expect(pools || delegates).toBe(true);
    }
  );

  it.each(fetchers().map(f => [f.name, f.source] as const))(
    '%s makes no request through bare axios',
    (_name, source) => {
      // `import axios` on its own is fine — several use `axios.isAxiosError`
      // to inspect a rejection. Issuing a request is what bypasses the pool.
      expect(source).not.toMatch(/\baxios\.(get|post|put|patch|delete|request)\s*[(<]/);
    }
  );
});

describe('pool configuration reaches every service it names', () => {
  it('exposes a config for each pooled service', async () => {
    // `getServiceConfig` falls back to the global defaults for an unknown name,
    // so a missing entry is a silent loss of per-service tuning rather than a
    // failure. This checks the names resolve to a usable config.
    const { getServiceConfig } = await import('../../lib/http-pool-config');

    for (const service of ['arxiv', 'biorxiv', 'core', 'doaj', 'europepmc',
                           'openaire', 'opencitations', 'plos', 'openalex',
                           'crossref', 'unpaywall', 'datacite', 'ncbi']) {
      const config = getServiceConfig(service);
      expect(config.maxSockets, service).toBeGreaterThan(0);
      expect(config.timeout, service).toBeGreaterThan(0);
    }
  });
});
