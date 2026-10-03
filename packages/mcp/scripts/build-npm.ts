/**
 * The package published to npm, generated from the workspace one.
 *
 * `packages/mcp/package.json` is private and depends on core and shared by
 * `workspace:*` — right for the monorepo, and wrong for npm, where those names
 * do not exist. This bundles every entry point a user can reach with esbuild,
 * inlining core and shared and leaving the public npm packages external, and
 * writes a manifest whose dependencies are exactly those externals.
 *
 * Run after `pnpm build`: it bundles core's compiled `dist/`.
 */
import { execFileSync } from 'child_process';
import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { build } from 'esbuild';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'npm');
const manifest = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const mcp = manifest(path.join(ROOT, 'package.json'));
const core = manifest(path.join(ROOT, '..', 'core', 'package.json'));

/** Left out of the bundle and installed from npm. A subpath (…/server/stdio) follows its package. */
const EXTERNAL = ['@modelcontextprotocol/server', 'zod', 'axios', 'axios-retry', 'xml2js', 'unpdf', 'node-html-parser'];

const range = (name: string): string => {
  const declared = mcp.dependencies?.[name] ?? core.dependencies?.[name];
  if (!declared) throw new Error(`No workspace manifest declares ${name}`);
  return declared;
};

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  await build({
    absWorkingDir: ROOT,
    entryPoints: { 'bin/stdio': 'src/bin/stdio.ts', 'bin/cli': 'src/bin/cli.ts' },
    outdir: path.join(OUT, 'dist'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: EXTERNAL,
    define: { __SCI_OPEN_COMMIT__: JSON.stringify(commit) },
    sourcemap: true,
    logLevel: 'info'
  });

  const published = {
    name: mcp.name,
    version: mcp.version,
    description: mcp.description,
    license: mcp.license,
    mcpName: mcp.mcpName,
    repository: { type: 'git', url: 'https://github.com/matiasrodlo/sci-open' }, // npm provenance checks it
    bin: { 'sci-open-mcp': 'dist/bin/stdio.js', 'sci-open': 'dist/bin/cli.js' },
    files: ['dist', 'fixtures', 'README.md', 'server.json'],
    engines: mcp.engines,
    dependencies: Object.fromEntries(EXTERNAL.map(name => [name, range(name)]))
  };
  writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
  for (const file of ['README.md', 'server.json']) copyFileSync(path.join(ROOT, file), path.join(OUT, file));
  // `--engine fixture` reads ../../fixtures/engine.json from dist/bin.
  cpSync(path.join(ROOT, 'fixtures'), path.join(OUT, 'fixtures'), { recursive: true });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
