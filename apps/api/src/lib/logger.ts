import { AsyncLocalStorage } from 'async_hooks';
import type { FastifyBaseLogger } from 'fastify';

/**
 * One log stream for the whole service.
 *
 * Connectors and pipeline code used `console.*` directly, which meant a search
 * emitted thousands of unstructured lines to stdout — outside Fastify's logger,
 * so the configured level did nothing and `NODE_ENV=production` silenced none
 * of it. Everything goes through here instead, and here forwards to Fastify's
 * pino instance: levelled, structured, and correlated with the request that
 * caused it — through `withLogger`, which each request enters, so a line a
 * provider writes mid-search carries that search's `reqId`. Until that existed
 * every such line went to the root logger and carried no request at all.
 *
 * The argument order is console's rather than pino's — message first, detail
 * second — because that is what the call sites already read like, and a logging
 * change is not worth rewriting them around. The detail is normalised into
 * pino's structured field before it goes out.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

let sink: FastifyBaseLogger | null = null;

/** The logger of the request whose work is running, where there is one. */
const current = new AsyncLocalStorage<FastifyBaseLogger>();

/** Called once at boot with the server's logger. */
export function useLogger(logger: FastifyBaseLogger): void {
  sink = logger;
}

/**
 * Runs `work` — and everything it starts, however asynchronously — logging to
 * `logger`. The server enters it for each request with that request's logger.
 */
export function withLogger<T>(logger: FastifyBaseLogger, work: () => T): T {
  return current.run(logger, work);
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
  const target = current.getStore() ?? sink;
  if (target) {
    target[level](fieldsFor(detail), msg);
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
