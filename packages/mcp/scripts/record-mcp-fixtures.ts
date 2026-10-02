/**
 * Records the answers `--engine fixture` serves (fixtures/engine.json) from the
 * live engine, the way apps/api/scripts/record-fixtures.ts records provider
 * responses. Re-record deliberately and review the diff: a changed fixture
 * changes what the evals measure.
 *
 *   UNPAYWALL_EMAIL=you@example.org pnpm --filter sci-open-mcp exec tsx scripts/record-mcp-fixtures.ts
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { createEngine, usableApiKey } from '@open-access-explorer/core';
import { fixtureKey, type Fixtures } from '../src/fixture-engine';

/** What the evals' first calls ask. Add a line when a dataset asks something new. */
const SEARCHES = [
  { q: 'TS=crispr', page: 1, pageSize: 10 },
  { q: 'TS=crispr', page: 2, pageSize: 10 },
  { q: 'TS=("base editing" AND plants) AND PY=2022-2026', page: 1, pageSize: 10 },
  { q: 'TI="attention is all you need"', page: 1, pageSize: 5 }
];
const IDS = ['arxiv:1706.03762'];
const DOIS = ['10.1371/journal.pone.0000217'];

async function main(): Promise<void> {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) throw new Error('Set UNPAYWALL_EMAIL: the recording asks Unpaywall too');
  const openalex = usableApiKey(process.env.OPENALEX_API_KEY);
  const engine = createEngine({
    userAgent: `sci-open-mcp fixtures (+https://github.com/matiasrodlo/sci-open; mailto:${email})`,
    ...(openalex ? { apiKeys: { openalex } } : {}),
    // The depth the MCP server reads at (D11), so the recordings are its answers.
    search: { depth: 300 }
  });

  const fixtures: Fixtures = { searches: {}, papers: {} };
  for (const params of SEARCHES) {
    const { response } = await engine.search({ ...params, filters: { openAccessOnly: true } });
    fixtures.searches[fixtureKey(params)] = response;
    console.log(`${params.q} p${params.page}: ${response.total} results, complete ${response.complete}`);
  }
  for (const id of IDS) {
    const paper = await engine.lookup(id);
    if (paper) fixtures.papers[paper.id] = paper;
    console.log(`${id}: ${paper ? paper.id : 'not found'}`);
  }
  for (const doi of DOIS) {
    const paper = await engine.lookupDoi(doi);
    if (paper) fixtures.papers[paper.id] = paper;
    console.log(`${doi}: ${paper ? paper.id : 'not found'}`);
  }

  const out = path.join(__dirname, '..', 'fixtures', 'engine.json');
  writeFileSync(out, `${JSON.stringify(fixtures, null, 1)}\n`);
  console.log(`${Object.keys(fixtures.searches).length} searches, ${Object.keys(fixtures.papers).length} papers → ${out}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
