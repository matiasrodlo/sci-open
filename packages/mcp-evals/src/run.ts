import Anthropic from '@anthropic-ai/sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Server } from './servers';

/** The model every case runs on, at a fixed effort so runs are comparable. */
export const MODEL = 'claude-opus-5-5';
const EFFORT = 'medium';

/** Claude Code cuts a tool result at 25,000 tokens; so does the harness, for
 * every server alike. sci-open's own budget keeps it far below. */
const MAX_RESULT_CHARS = 100_000;

let client: Anthropic | undefined;
/** Made on first use, so the suites that call no model need no credentials.
 * ANTHROPIC_API_KEY, or an `ant auth login` profile. */
const anthropic = () => (client ??= new Anthropic());

/** A server, started or reached as a client would: a command line over stdio,
 * or a URL over Streamable HTTP with a bearer token. */
export async function connect(server: Server): Promise<Client> {
  const mcp = new Client({ name: 'sci-open-evals', version: '0.1.0' });
  const { transport } = server;
  await mcp.connect(
    transport.kind === 'stdio'
      ? new StdioClientTransport({
          command: transport.command,
          args: [...transport.args],
          env: { ...process.env, SCI_OPEN_LOG_LEVEL: 'error', ...transport.env } as Record<string, string>,
          ...(transport.cwd ? { cwd: transport.cwd } : {})
        })
      : new StreamableHTTPClientTransport(new URL(transport.url), {
          ...(transport.token ? { authProvider: { token: async () => transport.token } } : {})
        })
  );
  return mcp;
}

export type Call = { name: string; input: unknown; isError: boolean };

/** What a server's calls asked of its sources. */
export type Upstream = { requests: number; openalexCostUsd: number };

/** The `_meta` key sci-open reports a call's requests under
 * (packages/mcp/src/provenance.ts, `USAGE_KEY`). The baselines send none. */
const USAGE_KEY = 'io.github.matiasrodlo/usage';

/** A call's upstream usage, when its server reports one. */
export function upstreamOf(result: { _meta?: Record<string, unknown> }): Upstream | undefined {
  const usage = result._meta?.[USAGE_KEY] as { upstream_requests?: unknown; openalex_cost_usd?: unknown } | undefined;
  if (typeof usage?.upstream_requests !== 'number') return undefined;
  return { requests: usage.upstream_requests, openalexCostUsd: typeof usage.openalex_cost_usd === 'number' ? usage.openalex_cost_usd : 0 };
}

/** Two usages summed; `undefined` stays so until a call reports one. */
export function addUpstream(a: Upstream | undefined, b: Upstream | undefined): Upstream | undefined {
  if (!a || !b) return a ?? b;
  return { requests: a.requests + b.requests, openalexCostUsd: Math.round((a.openalexCostUsd + b.openalexCostUsd) * 1e6) / 1e6 };
}

export type RunResult = {
  answer: string;
  calls: Call[];
  usage: { input: number; output: number; cacheRead: number; fallbackTurns: number };
  /** What the calls asked of the sources; absent for a server that does not say. */
  upstream?: Upstream;
  models: string[];
  stopReason: string;
};

/**
 * One prompt, through the server's tools, until the model answers or runs out
 * of turns. A manual loop rather than the SDK's tool runner: the tools come
 * from an MCP client at run time, and every turn's usage is recorded.
 */
export async function runCase(prompt: string, server: Server, maxTurns = 8): Promise<RunResult> {
  const mcp = await connect(server);

  try {
    const tools = (await mcp.listTools()).tools.filter(t => !server.hidden?.includes(t.name));
    // Claude Desktop and Claude Code put these in front of the model. Without
    // them the eval measures the tools minus the grammar and the recipes.
    const instructions = mcp.getInstructions();
    const anthropicTools: Anthropic.Beta.BetaTool[] = tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema
    }));

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const calls: Call[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, fallbackTurns: 0 };
    let upstream: Upstream | undefined;
    const models = new Set<string>();
    const done = (answer: string, stopReason: string): RunResult =>
      ({ answer, calls, usage, ...(upstream ? { upstream } : {}), models: [...models], stopReason });

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // A refused request re-runs on the fallback model Anthropic recommends
        // for its refusal category, inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        cache_control: { type: 'ephemeral' }, // tools + system are a stable prefix
        ...(instructions ? { system: instructions } : {}),
        tools: anthropicTools,
        messages
      });
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      // A turn rescued by the fallback model was answered by another model:
      // reported, and not scored as a measurement of this one.
      models.add(response.model);
      if ((response.usage.iterations ?? []).some(i => i.type === 'fallback_message')) usage.fallbackTurns++;

      messages.push({ role: 'assistant', content: response.content }); // whole, thinking blocks included
      if (response.stop_reason === 'pause_turn') continue;
      if (response.stop_reason !== 'tool_use') {
        const answer = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        return done(answer, response.stop_reason ?? 'unknown');
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        // Only a tool that was offered is ever called.
        const offered = tools.some(t => t.name === block.name);
        const result = offered
          ? await mcp.callTool({ name: block.name, arguments: block.input as Record<string, unknown> })
          : { isError: true, content: [{ type: 'text', text: `No tool named ${block.name}.` }] };
        calls.push({ name: block.name, input: block.input, isError: Boolean(result.isError) });
        upstream = addUpstream(upstream, upstreamOf(result as { _meta?: Record<string, unknown> }));
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: Boolean(result.isError),
          content: (result.content as Array<{ type: string; text?: string }>)
            .filter(c => c.type === 'text')
            .map(c => ({ type: 'text' as const, text: clamp(c.text ?? '') }))
        });
      }
      messages.push({ role: 'user', content: results }); // all results in one message
    }
    return done('', 'max_turns');
  } finally {
    await mcp.close();
  }
}

function clamp(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n\n[Cut by the eval harness at ${MAX_RESULT_CHARS} characters, as a client cuts a result over 25,000 tokens.]`;
}
