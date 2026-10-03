import type { EngineLogger } from '@sci-open/core';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

/** Fields that can hold what a user asked. Kept at debug, dropped above it. */
const PRIVATE = new Set(['query', 'q', 'reference', 'references', 'text']);

/**
 * The engine's logger on stdio: one JSON object per line on stderr, never
 * stdout, which belongs to the protocol. Nothing above `debug` holds a query
 * or a reference — the engine logs a rescue with `query`.
 */
export function stderrLogger(min: LogLevel): EngineLogger {
  const floor = LEVELS.indexOf(min);
  const write = (level: LogLevel) => (fields: Record<string, unknown>, msg: string) => {
    if (LEVELS.indexOf(level) < floor) return;
    const kept = level === 'debug' ? fields : Object.fromEntries(Object.entries(fields).filter(([k]) => !PRIVATE.has(k)));
    process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...kept })}\n`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
