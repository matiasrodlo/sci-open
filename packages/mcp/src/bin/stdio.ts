#!/usr/bin/env node
import './stdout-guard';
import path from 'path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createEngine, useLogger, type Engine } from '@open-access-explorer/core';
import { createServerFactory } from '../server';
import { selectTools } from '../toolsets';
import { readMcpConfig, type McpConfig } from '../config';
import { stderrLogger } from '../log';
import { createMetrics } from '../metrics';
import { fixtureEngine, loadFixtures } from '../fixture-engine';

function engineFor(config: McpConfig): Engine {
  if (config.engine === 'fixture') {
    // Recorded answers: deterministic and offline. Lenient, so a search nobody
    // recorded answers empty instead of failing the eval that asked it.
    const file = config.fixturesPath ?? path.join(__dirname, '..', '..', 'fixtures', 'engine.json');
    return fixtureEngine(loadFixtures(file), { strict: false });
  }
  return createEngine({
    userAgent: config.userAgent,
    apiKeys: config.apiKeys,
    search: { depth: config.searchDepth },
    ...(config.openCitationsToken ? { openCitationsToken: config.openCitationsToken } : {})
  });
}

function main(): void {
  const { config, warnings, exit } = readMcpConfig(process.env, process.argv.slice(2));
  if (exit) {
    process.stderr.write(`${exit.output}\n`);
    process.exit(exit.code);
  }

  const logger = stderrLogger(config.logLevel);
  useLogger(logger);
  for (const warning of warnings) logger.warn({}, warning);

  // A typo in a client config fails here, with the valid names, rather than
  // when the first client connects.
  try {
    selectTools(config);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }

  const handle = serveStdio(
    createServerFactory({ engine: engineFor(config), config, metrics: createMetrics(logger), transport: 'stdio' }),
    { onerror: error => logger.error({ err: error.message }, 'mcp transport error') }
  );

  const stop = () => void handle.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdin.on('end', stop); // the client closed the pipe
}

main();
