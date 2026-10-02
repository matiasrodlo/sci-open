/**
 * The README's tools table, generated from the schemas, so it cannot drift
 * from what clients are sent. Writes between the START and END markers; with
 * `--check` it changes nothing and exits 1 when the README is out of date,
 * which CI runs after the build.
 *
 *   pnpm --filter sci-open-mcp docs:tools [--check]
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as z from 'zod';
import { ALL_TOOLS, DEFAULT_TOOLSETS } from '../src/toolsets';

const README = path.join(__dirname, '..', 'README.md');
const START = '<!-- START TOOLS -->';
const END = '<!-- END TOOLS -->';

type JsonSchema = { properties?: Record<string, { description?: string }>; required?: string[] };

const rows = ALL_TOOLS.map(def => {
  // The input as a caller writes it: a field with a default is optional.
  const schema = z.toJSONSchema(def.input, { io: 'input' }) as JsonSchema;
  const params = Object.keys(schema.properties ?? {})
    .map(name => `\`${name}\`${schema.required?.includes(name) ? '' : '?'}`)
    .join(', ');
  const on = DEFAULT_TOOLSETS.includes(def.toolset) ? 'yes' : 'no';
  return `| \`${def.name}\` | ${def.toolset} | ${on} | ${def.description.replace(/\|/g, '\\|')} | ${params} |`;
});

const table = ['| Tool | Toolset | Default | What it does | Parameters |', '|---|---|---|---|---|', ...rows].join('\n');
const readme = readFileSync(README, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end < start) throw new Error(`README.md needs ${START} and ${END}`);
const next = `${readme.slice(0, start + START.length)}\n${table}\n${readme.slice(end)}`;

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md tools table is out of date: run pnpm --filter sci-open-mcp docs:tools');
    process.exit(1);
  }
} else {
  writeFileSync(README, next);
}
