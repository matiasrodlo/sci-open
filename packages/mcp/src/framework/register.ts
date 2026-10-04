import type { McpServer, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { inputOf, type ToolDefinition, type ToolDeps } from './define-tool';
import { writesAllowed } from '../config';
import { measureUpstream } from '@sci-open/core';
import { buildProvenance, PROVENANCE_KEY, usageMeta, type ServerIdentity } from '../provenance';
import { clampText } from '../shape/budget';
import { renderError, reportToolError, ToolError } from '../errors';

/**
 * A schema as tools/list shows it, that lets every input through. The SDK
 * would otherwise check it first and answer a bad argument in words of its
 * own — outside the error contract, the hint and the metrics — so
 * `registerTools` checks it instead (`parseArgs`).
 */
function advertised(schema: z.ZodObject): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'sci-open',
      validate: (value: unknown) => ({ value }),
      jsonSchema: schema['~standard'].jsonSchema
    }
  } as StandardSchemaWithJSON;
}

/** A call's arguments, checked against the input the tool is served with. */
function parseArgs(def: ToolDefinition<any, any>, input: z.ZodObject, writable: boolean, raw: unknown): Record<string, unknown> {
  // A write this server does not allow: say so, rather than that the
  // parameter is unknown, which is all the schema here can say.
  const given = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  if (!writable && def.writes?.some(name => given.includes(name))) {
    throw new ToolError('writes_disabled', 'This server is not allowed to write files.', 'Omit save_to to receive the content inline.');
  }
  const parsed = input.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ToolError(
      'invalid_input',
      `The arguments do not fit the tool's input schema:\n${z.prettifyError(parsed.error)}`,
      'Fix the arguments named above, as the input schema describes them, and call again.'
    );
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * The single place every cross-cutting rule is applied: annotations, progress,
 * admission counting, the text budget, provenance, error mapping, logging and metrics.
 * A tool's own code only computes its answer.
 */
export function registerTools(
  server: McpServer,
  tools: readonly ToolDefinition<any, any>[],
  deps: Omit<ToolDeps, 'progress' | 'signal'>,
  identity: ServerIdentity
): void {
  const writable = writesAllowed(deps);
  for (const def of tools) {
    const input = inputOf(def, writable);
    // Annotations describe a tool, not a call: one that can write a file when
    // asked is not read-only, and `overwrite: true` replaces one. Where writes
    // are not allowed it cannot, and its schema has no way to ask.
    const canWrite = Boolean(def.writes?.length) && writable;
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: advertised(input),
        outputSchema: def.output,
        annotations: {
          title: def.title,
          readOnlyHint: !canWrite,
          destructiveHint: canWrite,
          idempotentHint: !canWrite,
          openWorldHint: true
        }
      },
      async (raw: unknown, ctx: ServerContext) => {
        const started = Date.now();
        // Counted per call, so metrics can say how many calls cost a fan-out.
        let newSearches = 0;
        // Progress only for a request that carried a token: the spec's rule, and
        // what keeps a client that did not ask on a plain JSON response over HTTP.
        const token = ctx.mcpReq._meta?.progressToken;
        let step = 0;
        const callDeps: ToolDeps = {
          ...deps,
          signal: ctx.mcpReq.signal,
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
        // The arguments as checked, defaults filled in: what the tool runs on,
        // and what the provenance hashes.
        let args: Record<string, unknown> = {};
        // Every request the call sends the sources is charged to it (`_meta`, metrics).
        const measured = measureUpstream(async () => {
          args = parseArgs(def, input, writable, raw);
          return def.run(args as never, callDeps);
        });
        try {
          const outcome = await measured.done;
          const upstream = measured.usage();
          const provenance = buildProvenance(identity, def.name, args, outcome.structured, outcome.provenance);
          // Clients do not all show `_meta` to the model; one line of text
          // makes the hash something a skill can log.
          const { result_hash } = provenance[PROVENANCE_KEY] as { result_hash: string };
          const text = `${clampText(outcome.text, deps.config.textBudgetChars, outcome.continuation ?? 'Ask for less (a smaller page_size).')}\n\nResult hash: ${result_hash}`;
          deps.metrics.record({ tool: def.name, ok: true, ms: Date.now() - started, textChars: text.length, newSearches, upstream });
          return {
            content: [{ type: 'text' as const, text }, ...(outcome.resources ?? [])],
            structuredContent: outcome.structured,
            _meta: { ...provenance, ...usageMeta(upstream) }
          };
        } catch (raw) {
          // A failure can have cost the sources as much as an answer.
          const upstream = measured.usage();
          // The client cancelled: nothing failed, and nobody reads the answer.
          if (ctx.mcpReq.signal.aborted) {
            deps.logger.debug({ tool: def.name }, 'tool call cancelled');
            deps.metrics.record({ tool: def.name, ok: false, code: 'cancelled', ms: Date.now() - started, newSearches, upstream });
            return { isError: true, content: [{ type: 'text' as const, text: 'Error (cancelled): The call was cancelled.' }], _meta: usageMeta(upstream) };
          }
          const error = reportToolError(raw, def.name, deps.logger);
          deps.metrics.record({ tool: def.name, ok: false, code: error.code, ms: Date.now() - started, newSearches, upstream });
          // No structuredContent: an error result is not the declared output.
          return { isError: true, content: [{ type: 'text' as const, text: renderError(error) }], _meta: usageMeta(upstream) };
        }
      }
    );
  }
}
