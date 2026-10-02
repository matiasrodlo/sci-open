import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

/** The workspace's built binary, found through the dependency rather than a
 * path relative to wherever the harness happens to run. */
const STDIO_BIN = path.join(path.dirname(require.resolve('sci-open-mcp/package.json')), 'dist', 'bin', 'stdio.js');

/** The model every case runs on, at a fixed effort so runs are comparable. */
export const MODEL = 'claude-opus-5-5';
const EFFORT = 'medium';

let client: Anthropic | undefined;
/** Made on first use, so the suites that call no model need no credentials.
 * ANTHROPIC_API_KEY, or an `ant auth login` profile. */
const anthropic = () => (client ??= new Anthropic());

/** The stdio server, started as a client would start it. */
export async function connect(serverArgs: string[], env: Record<string, string> = {}): Promise<Client> {
  const mcp = new Client({ name: 'sci-open-evals', version: '0.1.0' });
  await mcp.connect(new StdioClientTransport({
    command: process.execPath,
    args: [STDIO_BIN, ...serverArgs],
    env: { ...process.env, SCI_OPEN_LOG_LEVEL: 'error', ...env } as Record<string, string>
  }));
  return mcp;
}

export type Call = { name: string; input: unknown; isError: boolean };

export type RunResult = {
  answer: string;
  calls: Call[];
  usage: { input: number; output: number; cacheRead: number; fallbackTurns: number };
  models: string[];
  stopReason: string;
};

/**
 * One prompt, through the server's tools, until the model answers or runs out
 * of turns. A manual loop rather than the SDK's tool runner: the tools come
 * from an MCP client at run time, and every turn's usage is recorded.
 */
export async function runCase(prompt: string, serverArgs: string[], maxTurns = 8): Promise<RunResult> {
  const mcp = await connect(serverArgs);

  try {
    const { tools } = await mcp.listTools();
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
    const models = new Set<string>();

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
        return { answer, calls, usage, models: [...models], stopReason: response.stop_reason ?? 'unknown' };
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await mcp.callTool({ name: block.name, arguments: block.input as Record<string, unknown> });
        calls.push({ name: block.name, input: block.input, isError: Boolean(result.isError) });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: Boolean(result.isError),
          content: (result.content as Array<{ type: string; text?: string }>)
            .filter(c => c.type === 'text')
            .map(c => ({ type: 'text' as const, text: c.text ?? '' }))
        });
      }
      messages.push({ role: 'user', content: results }); // all results in one message
    }
    return { answer: '', calls, usage, models: [...models], stopReason: 'max_turns' };
  } finally {
    await mcp.close();
  }
}
