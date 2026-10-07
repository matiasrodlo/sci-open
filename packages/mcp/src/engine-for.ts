import path from 'path';
import { createEngine, type Engine } from '@sci-open/core';
import type { McpConfig } from './config';
import { fixtureEngine, loadFixtures } from './fixture-engine';

/**
 * The engine a configuration asks for: the live sources, or the recorded
 * answers (`SCI_OPEN_ENGINE=fixture`). The server and the CLI both start from
 * here, so a setting that keeps one offline keeps the other offline too.
 */
export function engineFor(config: McpConfig): Engine {
  if (config.engine === 'fixture') {
    // Recorded answers: deterministic and offline. Lenient, so a search nobody
    // recorded answers empty instead of failing the eval that asked it.
    const file = config.fixturesPath ?? path.join(__dirname, '..', 'fixtures', 'engine.json');
    return fixtureEngine(loadFixtures(file), { strict: false });
  }
  return createEngine({
    userAgent: config.userAgent,
    apiKeys: config.apiKeys,
    depth: config.searchDepth,
    ...(config.openCitationsToken ? { openCitationsToken: config.openCitationsToken } : {})
  });
}
