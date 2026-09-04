import { describe, it, expect, afterEach } from 'vitest';
import { HttpClientFactory } from '../http-client-factory';

/**
 * There are two key spaces in this factory and they are not the same.
 *
 * `clients` is keyed by the **full** base URL, because several services live
 * under a path — NCBI's `/entrez/eutils`, OpenAIRE's `/search`, CORE's `/v3` —
 * and normalising that away made axios resolve every request against the bare
 * host. `metrics` is keyed by the **normalised** origin, so that per-host
 * figures are per host.
 *
 * Every write to `metrics` therefore has to go through `normalizeUrl`, and the
 * two below are the places that did not.
 */

// A base URL with a path, which is where the two key spaces diverge. Eight of
// the thirteen configured services have one.
const WITH_PATH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const ORIGIN = 'https://eutils.ncbi.nlm.nih.gov';

let factory: HttpClientFactory | undefined;

const build = () => {
  factory = new HttpClientFactory();
  return factory;
};

afterEach(async () => {
  // Destroys the keep-alive agents, so no handle outlives the test.
  await factory?.closeAllConnections();
  factory = undefined;
});

describe('metrics keying', () => {
  it('registers a client under its origin, not its full base URL', () => {
    const f = build();
    f.getClient(WITH_PATH);

    expect([...(f.getMetrics() as Map<string, unknown>).keys()]).toEqual([ORIGIN]);
  });

  it('keeps metrics reachable after a reset of every client', () => {
    // `resetMetrics()` cleared the map and then re-registered from the *client*
    // keys, which carry the path. Every service with a path ended up with an
    // entry under a key `updateMetrics` never looks up, and its
    // `if (!metrics) return` then dropped every later measurement for them —
    // silently, and for the life of the process.
    const f = build();
    f.getClient(WITH_PATH);

    f.resetMetrics();

    expect(f.getMetrics(WITH_PATH)).not.toBeNull();
    expect([...(f.getMetrics() as Map<string, unknown>).keys()]).toEqual([ORIGIN]);
  });

  it('does not zero a host counters when a second client on it is built', () => {
    // Two base URLs on one host share a metrics key. OpenAlex already drives
    // two code paths against `api.openalex.org`, and either service is one
    // endpoint away from needing a second base URL with a different path.
    const f = build();
    f.getClient('https://api.openalex.org');

    const metrics = f.getMetrics('https://api.openalex.org')!;
    metrics.totalRequests = 5;

    f.getClient('https://api.openalex.org/v2');

    expect(f.getMetrics('https://api.openalex.org')!.totalRequests).toBe(5);
  });

  it('reuses one client per full base URL', () => {
    const f = build();
    expect(f.getClient(WITH_PATH)).toBe(f.getClient(WITH_PATH));
  });

  it('keeps the path on the client, which is what axios resolves against', () => {
    const f = build();
    expect(f.getClient(WITH_PATH).defaults.baseURL).toBe(WITH_PATH);
  });
});
