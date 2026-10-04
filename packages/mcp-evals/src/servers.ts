import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from '@modelcontextprotocol/client';
import { upstreamOf, type Upstream } from './run';

/**
 * The servers a suite can run against: sci-open, and the baselines Step 12.4
 * compares it with. Each is started or reached the way a client would, and
 * scored by the same scorers.
 */
export type Server = {
  /** Its name in the report and in the report's file name. */
  name: string;
  transport:
    | { kind: 'stdio'; command: string; args: readonly string[]; env?: Record<string, string>; cwd?: string }
    | { kind: 'http'; url: string; token?: string };
  /** Tools never offered to the model: what this project will not use, or what
   * changes the machine running the eval. */
  hidden?: readonly string[];
  /**
   * The server's own reference checker, called directly with no model, its
   * answer given in verify_references' verdicts. A reference it gave no answer
   * for is `not_checked`. Absent, the references suite has Claude check them
   * with the server's tools instead.
   */
  verify?: (client: Client, references: readonly string[]) => Promise<{ verdicts: string[]; upstream?: Upstream }>;
};

/** The workspace's built binary, found through the dependency rather than a
 * path relative to wherever the harness happens to run. */
const STDIO_BIN = path.join(path.dirname(require.resolve('sci-open-mcp/package.json')), 'dist', 'bin', 'stdio.js');

/** sci-open's stdio server, with these arguments and extra environment. */
export function sciOpen(args: readonly string[] = [], env: Record<string, string> = {}): Server {
  return {
    name: 'sci-open',
    transport: { kind: 'stdio', command: process.execPath, args: [STDIO_BIN, ...args], env },
    async verify(client, references) {
      const result = await client.callTool({ name: 'verify_references', arguments: { references } }, { timeout: 600_000 });
      const structured = result.structuredContent as { results?: Array<{ verdict: string }> } | undefined;
      const upstream = upstreamOf(result as { _meta?: Record<string, unknown> });
      return { verdicts: references.map((_, i) => structured?.results?.[i]?.verdict ?? 'not_checked'), ...(upstream ? { upstream } : {}) };
    }
  };
}

/**
 * resolve_references grades a free-text citation by its title match — exact,
 * likely, uncertain or none — and looks a DOI, PMID or OpenAlex id up as
 * given. Its words, in verify_references' verdicts. It has none for a DOI that
 * names the wrong paper: such a reference resolves `exact`, is scored
 * `verified`, and counts against it, as it would for a user.
 */
const OPENALEX_MATCH: Record<string, string> = { exact: 'verified', likely: 'likely', uncertain: 'ambiguous', none: 'not_found' };

/** Its answer is JSON in the first text block; an error, or a result trimmed
 * to fit its size limit, leaves those references not_checked. */
export function openAlexVerdicts(content: unknown, isError: boolean, references: readonly string[]): string[] {
  const text = (content as Array<{ type: string; text?: string }> | undefined)?.find(c => c.type === 'text')?.text;
  let results: Array<{ input?: string; match?: string }> = [];
  if (!isError && text) {
    try {
      results = (JSON.parse(text) as { results?: typeof results }).results ?? [];
    } catch {
      results = [];
    }
  }
  return references.map((reference, i) => {
    const r = results[i];
    // It answers in order; a trimmed answer drops the tail.
    return r && r.input === reference.trim() && r.match ? (OPENALEX_MATCH[r.match] ?? 'not_checked') : 'not_checked';
  });
}

/**
 * The baselines Step 12.4 names, by the name `--server` takes.
 *
 * - `openalex`: the official OpenAlex server. It is remote only, at
 *   https://mcp.openalex.org/mcp, and every request needs a bearer token from
 *   its OAuth sign-in, which spends the signed-in account's OpenAlex budget.
 *   `OPENALEX_MCP_TOKEN` is that access token; `OPENALEX_MCP_URL` points at
 *   another deployment (its `npm run dev` serves http://localhost:8788/mcp).
 * - `paper-search`: paper-search-mcp from PyPI, through `uvx`, pinned. It reads
 *   the same `UNPAYWALL_EMAIL`, `CORE_API_KEY` and `DOAJ_API_KEY` sci-open
 *   does, so both run with the keys they share (0.1.4 takes no OpenAlex key).
 *   It runs in a temporary directory, since its download tools write
 *   `./downloads`, and its Sci-Hub routes are never offered — full text from
 *   legal copies only. `download_with_fallback` is one: it tries Sci-Hub last
 *   unless told not to.
 */
const BASELINES: Record<string, () => Server> = {
  openalex() {
    const token = process.env.OPENALEX_MCP_TOKEN;
    if (!token) {
      throw new Error(
        'The OpenAlex MCP server needs OPENALEX_MCP_TOKEN: an access token from its OAuth sign-in, ' +
        'which spends that account\'s OpenAlex budget. See packages/mcp-evals/README.md.'
      );
    }
    return {
      name: 'openalex',
      transport: { kind: 'http', url: process.env.OPENALEX_MCP_URL ?? 'https://mcp.openalex.org/mcp', token },
      async verify(client, references) {
        const verdicts: string[] = [];
        for (let i = 0; i < references.length; i += 25) {
          const batch = references.slice(i, i + 25);
          const result = await client.callTool({ name: 'resolve_references', arguments: { references: batch } }, { timeout: 600_000 });
          verdicts.push(...openAlexVerdicts(result.content, Boolean(result.isError), batch));
        }
        return { verdicts };
      }
    };
  },
  'paper-search'() {
    return {
      name: 'paper-search',
      transport: {
        kind: 'stdio',
        command: 'uvx',
        args: ['paper-search-mcp@0.1.4'],
        cwd: mkdtempSync(path.join(os.tmpdir(), 'sci-open-evals-paper-search-'))
      },
      hidden: ['download_scihub', 'download_with_fallback']
    };
  }
};

/** `sci-open` (with these arguments), or a baseline by name. */
export function serverNamed(name: string, sciOpenArgs: readonly string[], sciOpenEnv: Record<string, string> = {}): Server {
  if (name === 'sci-open') return sciOpen(sciOpenArgs, sciOpenEnv);
  const make = BASELINES[name];
  if (!make) throw new Error(`Unknown server "${name}": sci-open, ${Object.keys(BASELINES).join(', ')}`);
  return make();
}
