import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HttpPoolMetrics } from '../http-client-factory';

const { pool } = vi.hoisted(() => ({ pool: new Map<string, any>() }));

// The monitor reads the factory singleton on every tick, so the factory is
// what drives this test: the numbers below stand in for a service actually
// serving requests between samples.
vi.mock('../http-client-factory', () => ({
  httpClientFactory: { getMetrics: () => pool }
}));

import { HttpPerformanceMonitor } from '../http-performance-monitor';

const SERVICE = 'https://api.openalex.org';
const INTERVAL = 1000;

const counters = (totalRequests: number): HttpPoolMetrics => ({
  totalRequests,
  reusedConnections: 0,
  newConnections: 0,
  averageResponseTime: 0,
  errorRate: 0,
  lastReset: new Date()
});

let monitor: HttpPerformanceMonitor;

beforeEach(() => {
  vi.useFakeTimers();
  pool.clear();
  pool.set(SERVICE, counters(0));
  monitor = new HttpPerformanceMonitor();
});

afterEach(() => {
  monitor.stopMonitoring();
  vi.useRealTimers();
});

/** Advances one collection interval, having served `served` requests during it. */
const tick = (served: number) => {
  pool.set(SERVICE, counters(pool.get(SERVICE).totalRequests + served));
  vi.advanceTimersByTime(INTERVAL);
};

describe('throughput', () => {
  it('reports the interval that just elapsed, not the one before it', () => {
    // It was computed *before* `recordMetric` stored the new sample, so its
    // "latest" and "previous" were in fact samples n-1 and n-2: every figure
    // `/api/performance/*` served described the previous window. Here that
    // showed up as the second sample reporting 0 for a service that had just
    // served 30 requests, and the third reporting those 30 an interval late.
    monitor.startMonitoring(INTERVAL);

    tick(0);   // first sample: nothing elapsed yet
    tick(30);  // 30 requests over 1s

    expect(monitor.getCurrentMetrics(SERVICE)!.throughput).toBeCloseTo(30);
  });

  it('tracks a changing rate rather than lagging it', () => {
    monitor.startMonitoring(INTERVAL);

    tick(0);
    tick(30);
    tick(10);

    expect(monitor.getCurrentMetrics(SERVICE)!.throughput).toBeCloseTo(10);
  });

  it('reports zero for the first sample, where there is no interval to divide by', () => {
    monitor.startMonitoring(INTERVAL);

    tick(30);

    expect(monitor.getCurrentMetrics(SERVICE)!.throughput).toBe(0);
    expect(monitor.getCurrentMetrics(SERVICE)!.totalRequests).toBe(30);
  });

  it('clamps rather than reporting a reset as negative throughput', () => {
    // `resetMetrics` zeroes the counter, so it can go backwards between
    // samples. A negative rate is a worse answer than none.
    monitor.startMonitoring(INTERVAL);

    tick(0);
    tick(50);
    pool.set(SERVICE, counters(0));
    vi.advanceTimersByTime(INTERVAL);

    expect(monitor.getCurrentMetrics(SERVICE)!.throughput).toBe(0);
  });
});

describe('startMonitoring', () => {
  it('does not start a second interval over the first', () => {
    monitor.startMonitoring(INTERVAL);
    monitor.startMonitoring(INTERVAL);

    tick(0);
    tick(30);

    // Two intervals would collect twice per tick, so the second sample would
    // measure a zero-length window against itself.
    expect(monitor.getCurrentMetrics(SERVICE)!.throughput).toBeCloseTo(30);
  });

  it('stops collecting once stopped', () => {
    monitor.startMonitoring(INTERVAL);
    tick(0);
    monitor.stopMonitoring();

    tick(30);

    expect(monitor.getCurrentMetrics(SERVICE)!.totalRequests).toBe(0);
  });
});
