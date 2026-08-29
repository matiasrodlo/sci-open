import type { FastifyBaseLogger } from 'fastify';

/**
 * One log stream for the whole service.
 *
 * Connectors and pipeline code used `console.*` directly, which meant a search
 * emitted thousands of unstructured lines to stdout — outside Fastify's logger,
 * so the configured level did nothing and `NODE_ENV=production` silenced none
 * of it. Everything goes through here instead, and here forwards to Fastify's
 * pino instance: levelled, structured, and correlated with the request that
 * caused it.
 *
 * The argument order is console's rather than pino's — message first, detail
 * second — because that is what the call sites already read like, and a logging
 * change is not worth rewriting them around. The detail is normalised into
 * pino's structured field before it goes out.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

let sink: FastifyBaseLogger | null = null;

/** Called once at boot with the server's logger. */
export function useLogger(logger: FastifyBaseLogger): void {
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
