import type * as z from 'zod';
import type { Engine } from '@sci-open/core';
import type { ProvenanceInput } from '../provenance';
import type { McpConfig } from '../config';
import type { Metrics } from '../metrics';

export type Toolset = 'core' | 'read' | 'graph' | 'export';

/** What a tool's code is given. Everything cross-cutting is done around it. */
export type ToolDeps = {
  engine: Engine;
  config: McpConfig;
  metrics: Metrics;
  /** Spend one new-search admission; throws `AdmissionError` when refused. */
  admit: () => Promise<void>;
  transport: 'stdio' | 'http';
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
  /** True when the tool can write a file (only with save_to). */
  writes?: boolean;
  /** Computes the answer. Validation, budgets, provenance, errors and metrics
   * are `registerTools`' job, never a tool's. */
  run(args: z.infer<I>, deps: ToolDeps): Promise<ToolOutcome<z.infer<O>>>;
};

export const defineTool = <I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>) => def;
