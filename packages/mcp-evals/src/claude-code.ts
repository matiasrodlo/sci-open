import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { MODEL, type Call, type RunResult } from './run';
import type { Server } from './servers';

/** A case that runs this long has hung: a server that never answers, or a
 * prompt Claude Code is waiting on. */
const CASE_TIMEOUT_MS = 15 * 60_000;

/** The server as Claude Code's `--mcp-config` takes it. Its cwd, if any, is
 * where Claude Code itself runs, since a stdio server inherits it. */
function mcpConfig(server: Server): string {
  const t = server.transport;
  const entry = t.kind === 'stdio'
    ? { type: 'stdio', command: t.command, args: [...t.args], env: { SCI_OPEN_LOG_LEVEL: 'error', ...t.env } }
    : { type: 'http', url: t.url, ...(t.token ? { headers: { Authorization: `Bearer ${t.token}` } } : {}) };
  return JSON.stringify({ mcpServers: { [server.name]: entry } });
}

type StreamEvent = {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  mcp_servers?: Array<{ name: string; status: string }>;
  message?: { model?: string; content?: Array<{ type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean }> };
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
};

/**
 * Claude Code's `stream-json` output, read as runCase's result: every call to
 * the server's tools in order, under the server's own tool names, and the
 * final answer. A run that failed before measuring anything — not signed in,
 * the server not started, an API error — throws rather than score as a miss.
 */
export function readStream(lines: readonly string[], server: Server): RunResult {
  const prefix = `mcp__${server.name}__`;
  const calls: Array<Call & { id?: string }> = [];
  const models = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as StreamEvent;

    if (event.type === 'system' && event.subtype === 'init') {
      const status = event.mcp_servers?.find(s => s.name === server.name)?.status ?? 'missing';
      if (status !== 'connected') throw new Error(`Claude Code could not start ${server.name}: ${status}`);
    } else if (event.type === 'assistant') {
      const model = event.message?.model;
      if (model && model !== '<synthetic>') models.add(model);
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use' || !block.name) continue;
        const name = block.name.startsWith(prefix) ? block.name.slice(prefix.length) : block.name;
        calls.push({ id: block.id, name, input: block.input, isError: false });
      }
    } else if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_result') continue;
        const call = calls.find(c => c.id === block.tool_use_id);
        if (call) call.isError = Boolean(block.is_error);
      }
    } else if (event.type === 'result') {
      // error_max_turns is a run that ran out of turns, as runCase's can; any
      // other error measured nothing.
      if (event.is_error && event.subtype !== 'error_max_turns') throw new Error(`Claude Code: ${event.result ?? event.subtype}`);
      return {
        answer: event.subtype === 'success' ? (event.result ?? '') : '',
        calls: calls.map(({ name, input, isError }) => ({ name, input, isError })),
        usage: {
          input: event.usage?.input_tokens ?? 0,
          output: event.usage?.output_tokens ?? 0,
          cacheRead: event.usage?.cache_read_input_tokens ?? 0,
          fallbackTurns: 0
        },
        models: [...models],
        stopReason: event.subtype === 'error_max_turns' ? 'max_turns' : (event.stop_reason ?? 'end_turn')
      };
    }
  }
  throw new Error('Claude Code ended without a result');
}

/**
 * runCase through Claude Code instead of the Messages API: `claude -p` on the
 * signed-in Claude account, for anyone without an API key. Same model, same
 * server, same turn limit; but Claude Code's own system prompt, its own effort,
 * and its own way of handing the model the server's instructions. It measures
 * the tools as a Claude Code user meets them, and its numbers are not
 * comparable with runCase's.
 *
 * Only the server's tools are offered: the built-in ones are turned off, every
 * other MCP server and the user's settings are left out, and the server's
 * tools run without a permission prompt. Each case starts in an empty
 * directory (or the server's own cwd), so no project's CLAUDE.md is read.
 */
export function runClaudeCode(prompt: string, server: Server, maxTurns = 8): Promise<RunResult> {
  const hidden = (server.hidden ?? []).map(name => `mcp__${server.name}__${name}`);
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--model', MODEL,
    '--max-turns', String(maxTurns),
    '--strict-mcp-config', '--mcp-config', mcpConfig(server),
    '--tools', '',
    '--allowedTools', `mcp__${server.name}`,
    ...(hidden.length ? ['--disallowedTools', hidden.join(',')] : []),
    '--setting-sources', 'project',
    '--no-session-persistence'
  ];
  const cwd = (server.transport.kind === 'stdio' && server.transport.cwd)
    || mkdtempSync(path.join(os.tmpdir(), 'sci-open-evals-claude-code-'));

  return new Promise((resolve, reject) => {
    // Every tool loaded up front, as runCase offers them, rather than behind
    // Claude Code's tool search.
    const child = spawn('claude', args, { cwd, env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), CASE_TIMEOUT_MS);
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', error => {
      clearTimeout(timer);
      reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('Claude Code (`claude`) is not on the PATH') : error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        resolve(readStream(stdout.split('\n'), server));
      } catch (error) {
        reject(stderr.trim() ? new Error(`${(error as Error).message} (exit ${code}): ${stderr.trim()}`) : error);
      }
    });
    // The prompt goes in on stdin: as an argument, a variadic option before it
    // would take it for one of its values.
    child.stdin.end(prompt);
  });
}
