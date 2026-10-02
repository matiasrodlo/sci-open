/**
 * Records the answers `--engine fixture` serves (fixtures/engine.json) from the
 * live engine, the way apps/api/scripts/record-fixtures.ts records provider
 * responses. Re-record deliberately and review the diff: a changed fixture
 * changes what the evals measure.
 *
 *   UNPAYWALL_EMAIL=you@example.org pnpm --filter sci-open-mcp exec tsx scripts/record-mcp-fixtures.ts
 *
 * `--documents-only` keeps the recorded searches and papers and records the
 * full texts of the papers alone: Europe PMC and arXiv, no search fan-out.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
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
const IDS = ['arxiv:1706.03762', 'arxiv:2404.18021'];
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

  const out = path.join(__dirname, '..', 'fixtures', 'engine.json');
  const documentsOnly = process.argv.includes('--documents-only');
  if (documentsOnly && !existsSync(out)) throw new Error('--documents-only adds to fixtures/engine.json, which does not exist yet');
  const fixtures: Fixtures = documentsOnly
    ? { documents: {}, ...(JSON.parse(readFileSync(out, 'utf8')) as Fixtures) }
    : { searches: {}, papers: {}, documents: {} };
  const recorded = (match: (paper: Fixtures['papers'][string]) => boolean) => Object.values(fixtures.papers).find(match) ?? null;

  if (!documentsOnly) {
    for (const params of SEARCHES) {
      const { response } = await engine.search({ ...params, filters: { openAccessOnly: true } });
      fixtures.searches[fixtureKey(params)] = response;
      console.log(`${params.q} p${params.page}: ${response.total} results, complete ${response.complete}`);
    }
  }
  for (const id of IDS) {
    const unversioned = id.replace(/v\d+$/, '');
    const paper = recorded(p => p.id === id || p.id.replace(/v\d+$/, '') === unversioned) ?? (await engine.lookup(id));
    if (paper) fixtures.papers[paper.id] = paper;
    console.log(`${id}: ${paper ? paper.id : 'not found'}`);
  }
  for (const doi of DOIS) {
    const paper = (documentsOnly ? recorded(p => p.doi?.toLowerCase() === doi.toLowerCase()) : null) ?? (await engine.lookupDoi(doi));
    if (paper) fixtures.papers[paper.id] = paper;
    console.log(`${doi}: ${paper ? paper.id : 'not found'}`);
  }
  // Every recorded paper's full text, keyed by the id the fixture engine looks it up under.
  for (const paper of Object.values(fixtures.papers)) {
    const doc = await engine.readFullText(paper, { trustedOnly: false });
    if (doc) fixtures.documents![paper.id] = doc;
    console.log(`${paper.id}: ${doc ? `${doc.tier}, ${doc.sections.length} sections` : 'no full text'}`);
  }

  writeFileSync(out, `${JSON.stringify(fixtures, null, 1)}\n`);
  console.log(`${Object.keys(fixtures.searches).length} searches, ${Object.keys(fixtures.papers).length} papers, ${Object.keys(fixtures.documents ?? {}).length} full texts → ${out}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
