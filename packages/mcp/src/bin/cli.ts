#!/usr/bin/env node
import { readFileSync } from 'fs';
import { parseArgs } from 'util';
import * as z from 'zod';
import { createEngine, useLogger } from '@open-access-explorer/core';
import { readMcpConfig } from '../config';
import { stderrLogger } from '../log';
import { nullMetrics } from '../metrics';
import { tokenBucket } from '../admission';
import { ToolError, renderError, toToolError } from '../errors';
import type { ToolDefinition, ToolDeps } from '../framework/define-tool';
import { paperRefKind } from '../tools/resolve-paper';
import { searchPapers } from '../tools/search-papers';
import { getPaper } from '../tools/get-paper';
import { verifyReferences } from '../tools/verify-references';

const USAGE = `sci-open <command>

  search "<query>" [--page-size N] [--count]   search_papers (--count: count_only)
  paper <id or DOI>                            get_paper
  verify <file>                                verify_references, one reference per line (25 at most)

Configured by the same environment variables as sci-open-mcp.`;

function readArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      strict: true,
      options: {
        'page-size': { type: 'string' },
        count: { type: 'boolean' },
        help: { type: 'boolean' }
      }
    });
  } catch (error) {
    throw new ToolError('invalid_input', (error as Error).message, USAGE);
  }
}

/**
 * The same tool definitions the server registers, called directly — their
 * input validated by the same schemas, their text printed. The CLI owns its
 * terminal, so unlike the server it writes results to stdout, and it keeps
 * the untrusted fences: an agent reading this output needs them as much as
 * one calling the tools.
 */
async function main(): Promise<void> {
  const { values, positionals } = readArgs();
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const { config, warnings } = readMcpConfig(process.env, []);
  const logger = stderrLogger(config.logLevel);
  useLogger(logger);
  for (const warning of warnings) logger.warn({}, warning);

  const deps: ToolDeps = {
    engine: createEngine({ userAgent: config.userAgent, apiKeys: config.apiKeys, search: { depth: config.searchDepth } }),
    config,
    metrics: nullMetrics,
    transport: 'stdio',
    admit: tokenBucket(config.maxNewSearchesPerMinute),
    progress: () => {}
  };

  const run = async (def: ToolDefinition<any, any>, args: unknown): Promise<void> => {
    const parsed = def.input.safeParse(args); // the server's own limits and defaults
    if (!parsed.success) throw new ToolError('invalid_input', z.prettifyError(parsed.error));
    const outcome = await def.run(parsed.data, deps);
    process.stdout.write(`${outcome.text}\n`);
  };

  switch (command) {
    case 'search':
      return run(searchPapers, {
        query: rest.join(' '),
        ...(values['page-size'] ? { page_size: Number(values['page-size']) } : {}),
        ...(values.count ? { count_only: true } : {})
      });
    case 'paper':
      return run(getPaper, paperRefKind(rest[0] ?? ''));
    case 'verify':
      return run(verifyReferences, {
        references: readFileSync(rest[0] ?? '/dev/stdin', 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      });
    default:
      throw new ToolError('invalid_input', `Unknown command "${command}".`, USAGE);
  }
}

main().catch(error => {
  process.stderr.write(`${renderError(toToolError(error))}\n`);
  process.exit(1);
});
