/** The four methods the engine calls. The MCP binary installs a stderr logger
 * that satisfies this. */
export type EngineLogger = {
  debug(fields: Record<string, unknown>, msg: string): void;
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
};

/**
 * One log stream for the whole engine.
 *
 * Connectors and pipeline code used `console.*` directly, which meant a search
 * emitted thousands of unstructured lines to stdout — which, for an MCP server
 * on stdio, is the protocol channel. Everything goes through here instead, and
 * here forwards to the logger the process installed: levelled and structured.
 *
 * The argument order is console's — message first, detail second — because
 * that is what the call sites already read like. The detail is normalised into
 * structured fields before it goes out.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

let sink: EngineLogger | null = null;

/** Called once at boot with the server's logger. */
export function useLogger(logger: EngineLogger): void {
  sink = logger;
}

function fieldsFor(detail: unknown): Record<string, unknown> {
  if (detail === undefined) return {};
  if (detail instanceof Error) {
    return { err: { message: detail.message, name: detail.name, stack: detail.stack } };
  }
  if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  return { detail };
}

function emit(level: Level, msg: string, detail?: unknown): void {
  if (sink) {
    sink[level](fieldsFor(detail), msg);
    return;
  }
  // Before the server starts — scripts, tests — stay quiet unless something
  // actually went wrong, so test output is not buried in progress chatter.
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console[level](msg, detail ?? '');
  }
}

export const log = {
  debug: (msg: string, detail?: unknown) => emit('debug', msg, detail),
  info: (msg: string, detail?: unknown) => emit('info', msg, detail),
  warn: (msg: string, detail?: unknown) => emit('warn', msg, detail),
  error: (msg: string, detail?: unknown) => emit('error', msg, detail)
};
