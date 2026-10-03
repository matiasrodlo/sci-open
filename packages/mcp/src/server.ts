import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import type { Engine } from '@sci-open/core';
import { instructionsFor } from './instructions';
import { selectTools } from './toolsets';
import { registerTools } from './framework/register';
import type { McpConfig } from './config';
import type { Metrics } from './metrics';
import { tokenBucket } from './admission';
import { BUILD } from './build-info';

export type ServerDeps = {
  engine: Engine;
  config: McpConfig;
  metrics: Metrics;
  transport: 'stdio' | 'http';
  /** Spends one new-search admission. Defaults to a per-process token bucket. */
  admit?: () => Promise<void>;
};

export function createServer(deps: ServerDeps, request: { toolsets?: string[]; tools?: string[] } = {}): McpServer {
  const identity = { name: 'sci-open', version: BUILD.version, ...(BUILD.commit ? { commit: BUILD.commit } : {}) };
  const tools = selectTools({
    toolsets: request.toolsets ?? deps.config.toolsets,
    tools: request.tools ?? deps.config.tools
  });
  const server = new McpServer(
    { name: identity.name, title: 'sci-open — open-access literature', version: identity.version },
    {
      instructions: instructionsFor(tools),
      capabilities: { tools: {} },
      // tools/list never changes while a process runs; let clients cache it.
      cacheHints: { 'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' } }
    }
  );
  registerTools(server, tools, {
    engine: deps.engine,
    config: deps.config,
    metrics: deps.metrics,
    transport: deps.transport,
    admit: deps.admit ?? tokenBucket(deps.config.maxNewSearchesPerMinute)
  }, identity);
  return server;
}

/**
 * stdio: one connection, one instance. HTTP: one instance per request, with
 * per-request toolset selection from the URL (`?toolsets=core,graph`).
 *
 * The token bucket is made once here and shared by every instance the factory
 * makes; a bucket per instance would never run dry. That is right for stdio,
 * where the process is one user. Over HTTP a host passes its own per-client
 * `admit`, and this fallback is never built.
 */
export function createServerFactory(deps: ServerDeps): McpServerFactory {
  const admit = deps.admit ?? tokenBucket(deps.config.maxNewSearchesPerMinute);
  return ctx => createServer({ ...deps, admit }, ctx.requestInfo ? selectionFrom(new URL(ctx.requestInfo.url)) : {});
}

/** The toolsets and tools an HTTP request's URL asks for: `?toolsets=core,read&tools=…`. */
export function selectionFrom(url: URL): { toolsets?: string[]; tools?: string[] } {
  const list = (key: string) => url.searchParams.get(key)?.split(',').map(s => s.trim()).filter(Boolean);
  const toolsets = list('toolsets');
  const tools = list('tools');
  return { ...(toolsets ? { toolsets } : {}), ...(tools ? { tools } : {}) };
}
