#!/usr/bin/env node
import './stdout-guard';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { useLogger } from '@sci-open/core';
import { createServerFactory } from '../server';
import { selectTools } from '../toolsets';
import { readMcpConfig, type McpConfig } from '../config';
import { stderrLogger } from '../log';
import { createMetrics } from '../metrics';
import { engineFor } from '../engine-for';
import { startHttpServer } from '../http-server';
import { BUILD } from '../build-info';

async function serveHttp(config: McpConfig, http: NonNullable<McpConfig['http']>, logger: ReturnType<typeof stderrLogger>): Promise<void> {
  // D11: unkeyed, OpenAlex gives this process a tenth of a key's daily budget,
  // and every client would share it. Refuse rather than warn: a warning in a
  // container log is read after the budget is gone.
  if (config.engine === 'live' && !config.apiKeys.openalex && !http.allowUnkeyed) {
    process.stderr.write('Serving HTTP needs OPENALEX_API_KEY. Set it, or SCI_OPEN_ALLOW_UNKEYED=1 for a trial.\n');
    process.exit(2);
  }
  const metrics = createMetrics(logger);
  const server = await startHttpServer({
    deps: { engine: engineFor(config), config, metrics },
    http,
    newSearchesPerMinute: config.maxNewSearchesPerMinute,
    logger
  });
  logger.info({ url: server.url }, 'serving MCP over Streamable HTTP');
  process.stderr.write(`sci-open-mcp ${BUILD.version} serving ${server.url}\n`);
  // No stdin handler: a container closes stdin, and that must not stop a server.
  const stop = () => void server.close().finally(() => {
    metrics.stop();
    process.exit(0);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
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

  if (config.http) {
    serveHttp(config, config.http, logger).catch(error => {
      process.stderr.write(`Could not serve HTTP: ${(error as Error).message}\n`);
      process.exit(1);
    });
    return;
  }

  const handle = serveStdio(
    createServerFactory({ engine: engineFor(config), config, metrics: createMetrics(logger), logger, transport: 'stdio' }),
    { onerror: error => logger.error({ err: error.message }, 'mcp transport error') }
  );

  const stop = () => void handle.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdin.on('end', stop); // the client closed the pipe
}

main();
