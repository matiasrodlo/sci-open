import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS } from '../../orchestrator/registry';

/**
 * A normaliser cannot change shape without its version changing with it.
 *
 * `ProviderEntry.normalizerVersion` is in the provider cache key — see
 * `provider-cache.ts`, `v=${normalizerVersion}` — for exactly one reason: a
 * change to how a payload is read must not serve the papers the previous
 * reading produced. Nothing enforced the bump, and all ten versions have been
 * `1` since the registry was written, so the mechanism has never once done its
 * job. An edit to a `normalize.ts` ships against a warm cache and the old shape
 * keeps coming back until Redis expires it, which for a popular query is the
 * window in which the fix looks not to have worked.
 *
 * So the file is hashed and the hash is pinned beside the version it belongs
 * to. Editing a normaliser fails this test, and the fix is two lines: bump
 * `normalizerVersion` in `orchestrator/registry.ts`, and record the new hash
 * here. The failure message says so, because the person who hits it is usually
 * not the person who read this comment.
 *
 * **What this does not cover**, stated rather than implied: a normaliser's
 * output also depends on the shared helpers it calls — `stripMarkup`,
 * `normalizeDoi`, the URL screening — and a change *there* moves every
 * provider's output without touching a single `normalize.ts`. Hashing the
 * shared package here would trip all ten on any edit to it, most of which do
 * not touch normalisation, and a gate that cries wolf gets its numbers bumped
 * without thought. That case is still a manual judgement; this one no longer
 * is.
 */

/**
 * Each provider's normaliser as it stands, and the version that describes it.
 *
 * `version` mirrors `orchestrator/registry.ts` and is asserted against it, so
 * the two cannot drift apart silently either.
 */
const PINNED: Record<string, { version: number; normalizer: string }> = {
  arxiv: { version: 1, normalizer: 'dbdaf1e5d12a' },
  biorxiv: { version: 1, normalizer: '1090a5f4143e' },
  core: { version: 1, normalizer: '237c7946ed17' },
  datacite: { version: 1, normalizer: 'ae45bfbce3d8' },
  doaj: { version: 1, normalizer: '7412d502f23c' },
  europepmc: { version: 1, normalizer: 'a68e98b0d231' },
  ncbi: { version: 1, normalizer: '154d8a5c8fc5' },
  openaire: { version: 1, normalizer: '05fcde43e805' },
  openalex: { version: 1, normalizer: '62941ef2bcaa' },
  plos: { version: 1, normalizer: 'e007dcd2b4ea' }
};

const PROVIDER_DIR = join(__dirname, '..');

/** Twelve hex characters is far past collision by accident and fits on a line. */
function digest(provider: string): string {
  const source = readFileSync(join(PROVIDER_DIR, provider, 'normalize.ts'));
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

describe('normalizerVersion', () => {
  it.each(Object.keys(PINNED))('%s has not changed shape without changing version', provider => {
    expect(
      digest(provider),
      `apps/api/src/providers/${provider}/normalize.ts has changed.\n\n` +
        'Its output is cached under `normalizerVersion`, so the papers the old ' +
        'reading produced will keep being served until Redis expires them. Bump ' +
        `\`normalizerVersion\` for '${provider}' in orchestrator/registry.ts, then ` +
        'record the new hash and version here.\n\n' +
        'If the edit genuinely cannot change any output — a comment, a rename, a ' +
        'type-only change — record the hash and leave the version alone.'
    ).toBe(PINNED[provider]!.normalizer);
  });

  it('pins the version each registry entry actually declares', () => {
    // The other half. A hash recorded against a version this file made up would
    // be a gate that passes while the cache key stays put.
    const declared = Object.fromEntries(PROVIDERS.map(p => [p.id, p.normalizerVersion]));
    const pinned = Object.fromEntries(Object.entries(PINNED).map(([id, p]) => [id, p.version]));

    expect(declared).toEqual(pinned);
  });

  it('covers every provider in the registry', () => {
    // A provider added without a row here would arrive with its normaliser
    // unpinned, which is the state this test was written to end.
    expect(PROVIDERS.map(p => p.id).sort()).toEqual(Object.keys(PINNED).sort());
  });
});
