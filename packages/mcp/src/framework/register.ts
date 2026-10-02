import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { ToolDefinition, ToolDeps } from './define-tool';
import { buildProvenance, PROVENANCE_KEY, type ServerIdentity } from '../provenance';
import { clampText } from '../shape/budget';
import { renderError, toToolError } from '../errors';

/**
 * The single place every cross-cutting rule is applied: annotations, progress,
 * admission counting, the text budget, provenance, error mapping and metrics.
 * A tool's own code only computes its answer.
 */
export function registerTools(
  server: McpServer,
  tools: readonly ToolDefinition<any, any>[],
  deps: Omit<ToolDeps, 'progress'>,
  identity: ServerIdentity
): void {
  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        outputSchema: def.output,
        annotations: {
          title: def.title,
          // Annotations describe a tool, not a call: one that can write a file
          // when asked is not read-only, and `overwrite: true` replaces one.
          readOnlyHint: !def.writes,
          destructiveHint: Boolean(def.writes),
          idempotentHint: !def.writes,
          openWorldHint: true
        }
      },
      async (args: unknown, ctx: ServerContext) => {
        const started = Date.now();
        // Counted per call, so metrics can say how many calls cost a fan-out.
        let newSearches = 0;
        // Progress only for a request that carried a token: the spec's rule, and
        // what keeps a client that did not ask on a plain JSON response over HTTP.
        const token = ctx.mcpReq._meta?.progressToken;
        let step = 0;
        const callDeps: ToolDeps = {
          ...deps,
          admit: async () => {
            await deps.admit();
            newSearches++;
          },
          progress: (message, total) => {
            if (token === undefined) return;
            // `progress` must increase on every notification; one counter per call
            // guarantees it. Never awaited: a slow client must not slow the search.
            step++;
            void ctx.mcpReq
              .notify({
                method: 'notifications/progress',
                params: { progressToken: token, progress: step, ...(total !== undefined ? { total } : {}), message }
              })
              .catch(() => { /* a lost notification is not a failed call */ });
          }
        };
        try {
          const outcome = await def.run(args as never, callDeps);
          const provenance = buildProvenance(identity, def.name, args, outcome.structured, outcome.provenance);
          // Clients do not all show `_meta` to the model; one line of text
          // makes the hash something a skill can log.
          const { result_hash } = provenance[PROVENANCE_KEY] as { result_hash: string };
          const text = `${clampText(outcome.text, deps.config.textBudgetChars, outcome.continuation ?? 'Ask for less (a smaller page_size).')}\n\nResult hash: ${result_hash}`;
          deps.metrics.record({ tool: def.name, ok: true, ms: Date.now() - started, textChars: text.length, newSearches });
          return {
            content: [{ type: 'text' as const, text }, ...(outcome.resources ?? [])],
            structuredContent: outcome.structured,
            _meta: provenance
          };
        } catch (raw) {
          const error = toToolError(raw);
          deps.metrics.record({ tool: def.name, ok: false, code: error.code, ms: Date.now() - started, newSearches });
          // No structuredContent: an error result is not the declared output.
          return { isError: true, content: [{ type: 'text' as const, text: renderError(error) }] };
        }
      }
    );
  }
}
