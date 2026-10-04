import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ProviderReport } from '@sci-open/shared';
import { buildProvenance, canonicalJson, PROVENANCE_KEY } from '../src/provenance';
import { decodeSearchHandle, encodeSearchHandle, type SearchSpec } from '../src/handles';
import { hasVisibleText, sanitizeText, stripInvisible } from '../src/safety/sanitize';
import { fenceUntrusted } from '../src/safety/untrusted';
import { writeUserFile } from '../src/safety/paths';
import { clampText, fitWholeItems } from '../src/shape/budget';
import { coverageOf, coverageSentence } from '../src/shape/coverage';
import { tokenBucket } from '../src/admission';
import pLimit from '../src/p-limit';
import { ToolError } from '../src/errors';
import { BUILD } from '../src/build-info';

describe('canonicalJson', () => {
  it('does not depend on key order, and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }))
      .toBe(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('gives provenance hashes that move with the result and not with key order', () => {
    const at = () => new Date('2026-10-02T00:00:00Z');
    const server = { name: 'sci-open', version: '0.1.0' };
    const one = buildProvenance(server, 'search_papers', { query: 'x', page_size: 2 }, { a: 1, b: 2 }, {}, at)[PROVENANCE_KEY] as Record<string, string>;
    const two = buildProvenance(server, 'search_papers', { page_size: 2, query: 'x' }, { b: 2, a: 1 }, {}, at)[PROVENANCE_KEY] as Record<string, string>;
    const three = buildProvenance(server, 'search_papers', { query: 'x', page_size: 2 }, { a: 1, b: 3 }, {}, at)[PROVENANCE_KEY] as Record<string, string>;
    expect(one.query_hash).toBe(two.query_hash);
    expect(one.result_hash).toBe(two.result_hash);
    expect(three.result_hash).not.toBe(one.result_hash);
    expect(one.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('search handles', () => {
  const spec: SearchSpec = {
    q: 'TS=crispr', filters: { openAccessOnly: true, yearFrom: 2020, source: ['openalex', 'arxiv'] }, sort: 'relevance', pageSize: 10
  };

  it('round-trip, and treat a set filter as a set', () => {
    const handle = encodeSearchHandle(spec);
    expect(handle).toMatch(/^s1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10}$/);
    expect(decodeSearchHandle(handle)).toEqual({ ...spec, filters: { ...spec.filters, source: ['arxiv', 'openalex'] } });
    expect(encodeSearchHandle({ ...spec, filters: { ...spec.filters, source: ['arxiv', 'openalex'] } })).toBe(handle);
  });

  it('carry whether the search counted its facets, so its pages ask for the same set', () => {
    const counted = encodeSearchHandle({ ...spec, facets: true });
    expect(counted).not.toBe(encodeSearchHandle(spec));
    expect(decodeSearchHandle(counted).facets).toBe(true);
    expect(decodeSearchHandle(encodeSearchHandle(spec))).not.toHaveProperty('facets');
  });

  it('refuse a handle changed by one character', () => {
    const handle = encodeSearchHandle(spec);
    const i = handle.indexOf('.') + 5;
    const tampered = handle.slice(0, i) + (handle[i] === 'A' ? 'B' : 'A') + handle.slice(i + 1);
    expect(() => decodeSearchHandle(tampered)).toThrow(ToolError);
    expect(() => decodeSearchHandle(handle.slice(0, -1))).toThrow('not valid');
  });

  const signed = (body: string) => {
    // Recompute the checksum the way the encoder does, for a body it would never write.
    const encoded = Buffer.from(body).toString('base64url');
    return `s1.${encoded}.${createHash('sha256').update(encoded).digest('base64url').slice(0, 10)}`;
  };

  it('refuse a correctly checksummed body that is not JSON', () => {
    expect(() => decodeSearchHandle(signed('not json'))).toThrow('not valid');
  });

  it('refuse a re-checksummed body carrying what search_papers would refuse', () => {
    for (const bad of [
      { ...spec, pageSize: 500 },
      { ...spec, filters: { ...spec.filters, source: ['scihub'] } },
      { ...spec, filters: { ...spec.filters, venue: ['Nature'] } },
      { ...spec, extra: true }
    ]) {
      expect(() => decodeSearchHandle(signed(canonicalJson(bad)))).toThrow('not valid');
    }
  });
});

describe('sanitizing third-party text', () => {
  it('removes zero-width and bidi characters, and an encoded one in a second pass', () => {
    expect(sanitizeText('a\u200Bb\u202Ec')).toBe('abc');
    expect(sanitizeText('a&#8203;b', { decodeEntities: true })).toBe('ab');
    expect(sanitizeText('a &amp; b', { decodeEntities: true })).toBe('a & b');
  });

  it('keeps tabs and newlines, collapses blank runs, and cannot open a code fence', () => {
    expect(sanitizeText('a\tb\n\n\n\nc  \n```js')).toBe('a\tb\n\nc\nʼʼʼjs');
  });

  it('survives an entity past the end of Unicode', () => {
    expect(sanitizeText('x&#99999999;y', { decodeEntities: true })).toBe('xy');
  });

  it('strips only the invisible when lengths must hold', () => {
    expect(stripInvisible(' a\u200B \n')).toBe(' a \n');
    expect(hasVisibleText('\u200B \u2060')).toBe(false);
    expect(hasVisibleText(' x ')).toBe(true);
  });
});

describe('fenceUntrusted', () => {
  it('uses a fresh tag every call, so content cannot forge the closing one', () => {
    const a = fenceUntrusted('abstract', 'text');
    const b = fenceUntrusted('abstract', 'text');
    const tag = (s: string) => s.match(/<(untrusted-[0-9a-f-]{36})>/)![1];
    expect(tag(a)).not.toBe(tag(b));
    expect(a).toContain(`</${tag(a)}>`);
  });
});

describe('writeUserFile', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sci-open-'));

  it('refuses when writes are off', async () => {
    await expect(writeUserFile({ allowed: false }, path.join(dir, 'a'), '.md', 'x')).rejects.toMatchObject({ code: 'writes_disabled' });
  });

  it('refuses a relative path', async () => {
    await expect(writeUserFile({ allowed: true }, 'notes/a.md', '.md', 'x')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('forces the extension and will not overwrite unless asked', async () => {
    const target = await writeUserFile({ allowed: true }, path.join(dir, 'refs'), '.bib', 'one');
    expect(target).toBe(path.join(dir, 'refs.bib'));
    await expect(writeUserFile({ allowed: true }, target, '.bib', 'two')).rejects.toMatchObject({ code: 'invalid_input' });
    await writeUserFile({ allowed: true }, target, '.bib', 'two', true);
    expect(readFileSync(target, 'utf8')).toBe('two');
  });

  it('does not take ~user for the home directory', async () => {
    writeFileSync(path.join(dir, 'placeholder'), '');
    await expect(writeUserFile({ allowed: true }, '~someone/a.md', '.md', 'x')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('budgets', () => {
  it('keeps a prefix of whole items, never a later smaller one', () => {
    const items = ['a'.repeat(10), 'b'.repeat(100), 'c'];
    expect(fitWholeItems(items, 60, s => s.length)).toEqual({ kept: ['a'.repeat(10)], omitted: 2 });
    expect(fitWholeItems(items, 5, s => s.length)).toEqual({ kept: ['a'.repeat(10)], omitted: 2 });
    expect(fitWholeItems(items, 1000, s => s.length)).toEqual({ kept: items, omitted: 0 });
  });

  it('closes a fence it cuts inside, before saying how to continue', () => {
    const fenced = fenceUntrusted('paper text', Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'));
    const clamped = clampText(fenced, 400, 'Continue with offset=400.');
    const tag = fenced.match(/<(untrusted-[0-9a-f-]{36})>/)![1];
    expect(clamped).toContain(`</${tag}>\n\n[Truncated to fit the response limit. Continue with offset=400.]`);
    expect(clampText('short', 400, 'x')).toBe('short');
  });
});

describe('coverage', () => {
  const report = (provider: ProviderReport['provider'], over: Partial<ProviderReport> = {}): ProviderReport =>
    ({ provider, status: 'ok', retrieved: 10, latency: 1, ...over });

  it('says everything answered when it did', () => {
    const c = coverageOf({ complete: true, bounded: false, providers: [report('arxiv'), report('openalex', { totalHits: 9 })] });
    expect(coverageSentence(c)).toBe('2 of 2 sources answered.');
    expect(c.per_source[1]).toEqual({ source: 'openalex', status: 'ok', retrieved: 10, total_hits: 9 });
  });

  it('names failures, a spent quota, skips and a bounded access check', () => {
    const c = coverageOf({
      complete: false,
      bounded: true,
      providers: [
        report('arxiv'),
        report('europepmc', { status: 'timeout', retrieved: 0 }),
        report('openalex', { status: 'error', retrieved: 0, rateLimited: 'cooling-down' }),
        report('biorxiv', { status: 'skipped', retrieved: 0, skipReason: 'no keyword index' })
      ]
    });
    expect(c.failed).toEqual([{ source: 'europepmc', status: 'timeout' }, { source: 'openalex', status: 'error', rate_limited: true }]);
    expect(coverageSentence(c)).toBe(
      '1 of 3 sources answered; no answer from europepmc (timeout) — the total is a lower bound; ' +
      'openalex (request quota spent) left out for a few minutes — the total is a lower bound; ' +
      'skipped biorxiv (no keyword index); the access check was cut short, so a few papers may be missing.'
    );
  });
});

describe('tokenBucket', () => {
  it('admits a burst of its size, then refuses with the wait, then refills', async () => {
    let t = 0;
    const admit = tokenBucket(3, () => t);
    await admit();
    await admit();
    await admit();
    await expect(admit()).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 20 });
    t = 20_000;
    await expect(admit()).resolves.toBeUndefined();
  });
});

describe('pLimit', () => {
  it('never runs more than the limit, settles everything, and is not stalled by a failure', async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    const task = (fail: boolean) => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      if (fail) throw new Error('boom');
      return 'ok';
    };
    const results = await Promise.allSettled([true, false, true, false, false].map(f => limit(task(f))));
    expect(peak).toBe(2);
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });

  it('is not stalled by a task that throws before it returns a promise', async () => {
    const limit = pLimit(1);
    await expect(limit(() => { throw new Error('sync'); })).rejects.toThrow('sync');
    await expect(limit(async () => 'after')).resolves.toBe('after');
  });
});

describe('build info', () => {
  const json = (...parts: string[]) => JSON.parse(readFileSync(path.join(__dirname, '..', ...parts), 'utf8'));

  it('says the version package.json says', () => {
    expect(BUILD.version).toBe(json('package.json').version);
  });

  it('is the version the registry entry and the plugin name', () => {
    // Bumped together (Step 14.4); the release workflow checks the tag
    // against them too, but a drift should fail the commit that made it.
    const { version } = json('package.json');
    const server = json('server.json');
    expect(server.version).toBe(version);
    expect(server.packages[0].version).toBe(version);
    expect(json('..', '..', 'plugin', '.claude-plugin', 'plugin.json').version).toBe(version);
    expect(json('..', '..', 'plugin', '.mcp.json').mcpServers['sci-open'].args).toContain(`sci-open-mcp@${version}`);
  });

  it('describes itself to the registry in at most 100 characters', () => {
    // The registry's schema caps it, and refuses the publish past it.
    expect(json('server.json').description.length).toBeLessThanOrEqual(100);
  });

  it('asks an installer for the OpenAlex key, and the plugin passes on whatever the registry entry asks for', () => {
    // An installer driven by the registry prompts only for what it declares,
    // and the key decides whether OpenAlex lasts the day (D11).
    const declared = json('server.json').packages[0].environmentVariables.map((v: { name: string }) => v.name);
    expect(declared).toContain('OPENALEX_API_KEY');
    expect(Object.keys(json('..', '..', 'plugin', '.mcp.json').mcpServers['sci-open'].env).sort()).toEqual([...declared].sort());
  });
});
