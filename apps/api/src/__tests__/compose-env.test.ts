import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS } from '../config';

/**
 * Every setting this service reads has to reach the container that runs it.
 *
 * `docker-compose.yml` lists the environment explicitly rather than handing the
 * whole `.env` over, which is the right call — the compose network needs its own
 * `REDIS_URL` whatever the host file says — but it means each new setting is a
 * second edit that nothing enforced. The file's own comment records the first
 * time this bit: DOAJ's and DataCite's keys were missing while their three
 * siblings were passed, so a key set in `.env` worked locally and silently did
 * not work in a container.
 *
 * It bit again, and worse, because the failure is invisible from inside. A
 * missing key is not an error — it is the anonymous rate limit, or a default
 * budget — so the service starts, answers, and behaves as though the setting
 * were never written. Measured when this test was added: thirteen documented
 * settings were read by the API and passed by nothing, `OPENALEX_API_KEY` among
 * them, added two commits after the key itself.
 *
 * So the check is mechanical. Read the environment the source actually asks
 * for, read what compose actually passes, and require an explicit entry in
 * `NOT_PASSED` for each difference — which turns forgetting into a failing test
 * and deciding into one line with a reason on it.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const SRC = join(__dirname, '..');

/**
 * Settings the API reads and compose deliberately does not pass.
 *
 * Each needs a reason, and "we have not got round to it" is not one — that is
 * the case this test exists to catch. Add a line here only when the container
 * genuinely should not see the value.
 */
const NOT_PASSED: Record<string, string> = {
  // Compose sets these itself, on the line above where they would be read from
  // the host: the API's Redis is the service on the compose network, not
  // whatever the developer's `.env` points at.
  NODE_ENV: 'set by compose to production',
  PORT: 'set by compose',
  REDIS_URL: 'set by compose to the service name on its own network',
  NODE_OPTIONS: 'set by compose for Node itself, which sizes the heap from it'
};

/**
 * Every setting the service reads: the ones `config.ts` declares, which is
 * where settings are read now, and any `process.env.X` still left in the
 * source. The declaration is what brings the fourteen `<NAME>_POOL_CONFIG`
 * settings into this check — they were read under computed names a scan for
 * `process.env.X` could not see, and compose passed none of them.
 */
function settingsReadBySource(): Set<string> {
  const found = new Set<string>(SETTINGS);

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== '__tests__') walk(path);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;

      for (const match of readFileSync(path, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        found.add(match[1]!);
      }
    }
  };

  walk(SRC);
  return found;
}

/**
 * One service's `environment:` block, each name with the value as written.
 *
 * Parsed by hand rather than with a YAML library: the assertion is about one
 * block of one file whose shape is fixed, and adding a dependency to the
 * service in order to test its deployment file would be the larger cost.
 */
function composeEnvironment(service: string): Map<string, string> {
  const lines = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8').split('\n');

  const start = lines.findIndex(line => line.startsWith(`  ${service}:`));
  expect(start, `docker-compose.yml has a \`${service}\` service`).toBeGreaterThan(-1);

  // The next service at the same indentation ends the block.
  const after = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  const block = lines.slice(start, after === -1 ? lines.length : after);

  const environment = new Map<string, string>();
  for (const line of block) {
    const match = line.match(/^\s+- ([A-Z0-9_]+)=(.*)$/);
    if (match) environment.set(match[1]!, match[2]!);
  }
  return environment;
}

/** The names in the `api` service's `environment:` block. */
function settingsPassedByCompose(): Set<string> {
  return new Set(composeEnvironment('api').keys());
}

describe('docker-compose passes what the service reads', () => {
  it('leaves no setting behind without a stated reason', () => {
    const passed = settingsPassedByCompose();

    const missing = [...settingsReadBySource()]
      .filter(name => !passed.has(name) && !(name in NOT_PASSED))
      .sort();

    expect(missing, 'read by apps/api but not passed in docker-compose.yml').toEqual([]);
  });

  it('passes nothing the service has stopped reading', () => {
    // The other direction, and the reason it is worth asserting: a setting
    // removed from the code leaves a line in compose that reads like a working
    // knob and turns nothing.
    const read = settingsReadBySource();

    const stale = [...settingsPassedByCompose()]
      .filter(name => !read.has(name) && !(name in NOT_PASSED))
      .sort();

    expect(stale, 'passed in docker-compose.yml but read by nothing').toEqual([]);
  });

  it('keeps the deliberate exclusions honest', () => {
    // An entry in `NOT_PASSED` for something nobody reads any more is a reason
    // attached to nothing, and it would hide the next real omission of that
    // name behind a stale exemption.
    const read = settingsReadBySource();
    const passed = settingsPassedByCompose();

    const unused = Object.keys(NOT_PASSED)
      .filter(name => !read.has(name) && !passed.has(name))
      .sort();

    expect(unused, 'exempted in NOT_PASSED but read by nothing').toEqual([]);
  });
});

/**
 * The other way a container gets its environment wrong: handed the host's.
 *
 * `.env` is written for the dev servers, which run on the host — the README's
 * Quick Start copies it from `docs/env.example`, where `API_ORIGIN` and
 * `REDIS_URL` both name `localhost`. Compose fills `${…}` from the same file,
 * so a setting interpolated from it reaches a container meaning the container
 * itself. `API_ORIGIN` was, with the right address only as a fallback that the
 * example's value always pre-empted: the web container forwarded every request
 * to its own port 4000, and every search answered 502 while all three services
 * reported healthy.
 */
describe('docker-compose does not hand a container the host\'s addresses', () => {
  /** What `docs/env.example` points at this machine: right for `pnpm dev`, wrong in a container. */
  function hostLocalSettings(): Set<string> {
    const local = new Set<string>();
    for (const line of readFileSync(join(ROOT, 'docs', 'env.example'), 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && /\b(localhost|127\.0\.0\.1)\b/.test(match[2]!)) local.add(match[1]!);
    }
    return local;
  }

  it('interpolates none of the settings the example points at localhost', () => {
    const local = hostLocalSettings();
    // Not vacuous: these two are what the example is written with.
    expect([...local]).toEqual(expect.arrayContaining(['API_ORIGIN', 'REDIS_URL']));

    const interpolated = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .flatMap(line => [...line.matchAll(/\$\{([A-Z0-9_]+)/g)].map(match => match[1]!));

    expect(interpolated.filter(name => local.has(name)).sort(), 'filled from the host .env').toEqual([]);
  });

  it('points the web container at the api service', () => {
    // Dropping the line is the same failure by another route: the web's own
    // default, in `lib/fetcher.ts` and the proxy, is `http://localhost:4000`.
    expect(composeEnvironment('web').get('API_ORIGIN')).toBe('http://api:4000');
  });
});
