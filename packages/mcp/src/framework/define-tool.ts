import type * as z from 'zod';
import type { Engine, EngineLogger } from '@sci-open/core';
import type { ProvenanceInput } from '../provenance';
import type { McpConfig } from '../config';
import type { Metrics } from '../metrics';

export type Toolset = 'core' | 'read' | 'graph' | 'export';

/** What a tool's code is given. Everything cross-cutting is done around it. */
export type ToolDeps = {
  engine: Engine;
  config: McpConfig;
  metrics: Metrics;
  /** Where a failure's cause goes; the model is told only its code. See `reportToolError`. */
  logger: EngineLogger;
  /** Spend one new-search admission; throws `AdmissionError` when refused. */
  admit: () => Promise<void>;
  transport: 'stdio' | 'http';
  /** The call's: aborts when the client cancels it. Handed to every engine call
   * that asks the sources, which then stop. Built per call by `registerTools`. */
  signal: AbortSignal;
  /** One progress notification, when the client asked for them; a no-op
   * otherwise. Built per call by `registerTools`. */
  progress: (message: string, total?: number) => void;
};

export type EmbeddedResource = {
  type: 'resource';
  resource: { uri: string; mimeType: string; text: string };
};

export type ToolOutcome<O> = {
  structured: O;
  /** Markdown for the model. Third-party text must already be fenced. */
  text: string;
  /** Said when the text budget binds. */
  continuation?: string;
  provenance?: ProvenanceInput;
  resources?: EmbeddedResource[];
};

export type ToolDefinition<I extends z.ZodObject, O extends z.ZodObject> = {
  name: string;
  title: string;
  toolset: Toolset;
  description: string;
  input: I;
  output: O;
  /** The parameters that write a file (`save_to`, `overwrite`). Where writes
   * are not allowed they are left out of the schema, and the tool is
   * read-only (`inputOf`). */
  writes?: readonly string[];
  /** Computes the answer. Validation, budgets, provenance, errors and metrics
   * are `registerTools`' job, never a tool's. */
  run(args: z.infer<I>, deps: ToolDeps): Promise<ToolOutcome<z.infer<O>>>;
};

export const defineTool = <I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>) => def;

/**
 * The input a tool takes where it is served: its schema, strict — a parameter
 * it does not take is refused, not dropped, so `pagesize: 5` is a typo the
 * caller hears about rather than a page of the default size — and without the
 * parameters that write a file where writes are not allowed.
 */
export function inputOf(def: ToolDefinition<any, any>, writable: boolean): z.ZodObject {
  const input: z.ZodObject = def.input;
  const served = def.writes?.length && !writable
    // A mask built at run time, which zod types key by key.
    ? input.omit(Object.fromEntries(def.writes.map(name => [name, true])) as never)
    : input;
  return served.strict();
}
