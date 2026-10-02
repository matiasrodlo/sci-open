import { describe, it, expect } from 'vitest';
import type { ProviderReport } from '@open-access-explorer/shared';
import { UpstreamStats } from '../upstream-stats';

const report = (over: Partial<ProviderReport> = {}): ProviderReport => ({
  provider: 'europepmc', status: 'ok', retrieved: 600, latency: 1000, ...over
});

describe('UpstreamStats', () => {
  it('counts each provider by how its searches ended', () => {
    const stats = new UpstreamStats();
    stats.recordProviders([report(), report({ provider: 'openalex', status: 'timeout', latency: 20000, error: 'exceeded the 20000ms budget' })]);
    stats.recordProviders([report({ status: 'error', latency: 50, error: 'Europe PMC 503' })]);

    const { providers } = stats.snapshot();
    expect(providers.europepmc).toMatchObject({ ok: 1, error: 1, timeout: 0, lastError: { message: 'Europe PMC 503' } });
    expect(providers.openalex).toMatchObject({ timeout: 1, lastError: { message: 'exceeded the 20000ms budget' } });
  });

  it('reads percentiles off the recent latencies, leaving skips out', () => {
    const stats = new UpstreamStats();
    stats.recordProviders(Array.from({ length: 100 }, (_, i) => report({ latency: i + 1 })));
    stats.recordProviders([report({ status: 'skipped', latency: 0 })]);

    const latency = stats.snapshot().providers.europepmc!.latency!;
    expect(latency).toEqual({ p50: 50, p95: 95, samples: 100 });
  });

  it('keeps only the most recent latencies', () => {
    const stats = new UpstreamStats();
    stats.recordProviders(Array.from({ length: 300 }, () => report({ latency: 5000 })));
    stats.recordProviders(Array.from({ length: 256 }, () => report({ latency: 100 })));

    expect(stats.snapshot().providers.europepmc!.latency).toEqual({ p50: 100, p95: 100, samples: 256 });
  });

  it('adds up what the authorities were asked and what it bought', () => {
    const stats = new UpstreamStats();
    const unpaywall = { authority: 'unpaywall' as const, status: 'ok' as const, asked: 20, answered: 12, applied: 9, latency: 800 };
    stats.recordAuthorities([unpaywall]);
    stats.recordAuthorities([{ ...unpaywall, asked: 5, answered: 5, applied: 1 }]);

    expect(stats.snapshot().authorities.unpaywall).toMatchObject({ ok: 2, asked: 25, answered: 17, applied: 10 });
  });
});
