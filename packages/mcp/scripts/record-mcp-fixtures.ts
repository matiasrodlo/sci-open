/**
 * Records the answers `--engine fixture` serves (fixtures/engine.json) from the
 * live engine, the way packages/core/scripts/record-fixtures.ts records provider
 * responses. Re-record deliberately and review the diff: a changed fixture
 * changes what the evals measure.
 *
 *   UNPAYWALL_EMAIL=you@example.org pnpm --filter sci-open-mcp exec tsx scripts/record-mcp-fixtures.ts
 *
 * `--documents-only` keeps the recorded searches and papers and records the
 * full texts of the papers alone: Europe PMC and arXiv, no search fan-out.
 *
 * `--citations-only` keeps everything else and records the citation lists
 * below, with OpenAlex's records for each list's first page and for the
 * papers the export cases name: OpenCitations and a few OpenAlex list
 * queries, no search fan-out. UNPAYWALL_EMAIL is optional in this mode.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { createEngine, usableApiKey } from '@sci-open/core';
import { citationKey, fixtureKey, type Fixtures } from '../src/fixture-engine';

/** What the evals' first calls ask. Add a line when a dataset asks something new. */
const SEARCHES = [
  { q: 'TS=crispr', page: 1, pageSize: 10 },
  { q: 'TS=crispr', page: 2, pageSize: 10 },
  { q: 'TS=("base editing" AND plants) AND PY=2022-2026', page: 1, pageSize: 10 },
  { q: 'TI="attention is all you need"', page: 1, pageSize: 5 }
];
const IDS = ['arxiv:1706.03762', 'arxiv:2404.18021'];
const DOIS = ['10.1371/journal.pone.0000217'];

/** Citation lists the evals and demos ask for, recorded whole. */
const CITATIONS: Array<[doi: string, direction: 'references' | 'cited_by']> = [
  ['10.7717/peerj-cs.421', 'references'],
  ['10.7717/peerj-cs.421', 'cited_by'],
  ['10.1371/journal.pone.0000217', 'references'],
  ['10.1371/journal.pone.0000217', 'cited_by'],
  ['10.1016/j.cell.2011.02.013', 'references']
  // Not 10.48550/arXiv.1706.03762's citers, which ts-53 asks for: 24,956
  // links, 8.5 MB. That case scores the first call, which needs no recording.
];
/** A longer list is left out rather than cut: a cut one would misstate its own total. */
const MAX_LINKS = 1000;
/** Records for the first page of each list, as get_citations shows it. */
const FIRST_PAGE = 20;
/** Papers the export cases name. */
const EXPORT_DOIS = ['10.1038/nature14539', '10.1126/science.aaa8415', '10.7717/peerj-cs.421', '10.1371/journal.pone.0000217'];

async function main(): Promise<void> {
  const citationsOnly = process.argv.includes('--citations-only');
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email && !citationsOnly) throw new Error('Set UNPAYWALL_EMAIL: the recording asks Unpaywall too');
  const openalex = usableApiKey(process.env.OPENALEX_API_KEY);
  const engine = createEngine({
    userAgent: `sci-open-mcp fixtures (+https://github.com/matiasrodlo/sci-open${email ? `; mailto:${email}` : ''})`,
    ...(openalex ? { apiKeys: { openalex } } : {}),
    // The depth the MCP server reads at (D11), so the recordings are its answers.
    search: { depth: 300 }
  });

  const out = path.join(__dirname, '..', 'fixtures', 'engine.json');
  const documentsOnly = process.argv.includes('--documents-only');
  const adding = documentsOnly || citationsOnly;
  if (adding && !existsSync(out)) throw new Error('--documents-only and --citations-only add to fixtures/engine.json, which does not exist yet');
  const fixtures: Fixtures = adding
    ? { documents: {}, citations: {}, ...(JSON.parse(readFileSync(out, 'utf8')) as Fixtures) }
    : { searches: {}, papers: {}, documents: {}, citations: {} };
  if (citationsOnly) {
    await recordCitations(engine, fixtures);
    writeFileSync(out, `${JSON.stringify(fixtures, null, 1)}\n`);
    console.log(`${Object.keys(fixtures.citations ?? {}).length} citation lists, ${Object.keys(fixtures.papers).length} papers → ${out}`);
    return;
  }
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

  if (!documentsOnly) await recordCitations(engine, fixtures);

  writeFileSync(out, `${JSON.stringify(fixtures, null, 1)}\n`);
  console.log(`${Object.keys(fixtures.searches).length} searches, ${Object.keys(fixtures.papers).length} papers, ${Object.keys(fixtures.documents ?? {}).length} full texts → ${out}`);
}

/** The citation lists, then OpenAlex's records for their first pages and the export papers. */
async function recordCitations(engine: ReturnType<typeof createEngine>, fixtures: Fixtures): Promise<void> {
  fixtures.citations ??= {};
  const wanted = new Set(EXPORT_DOIS);
  for (const [doi, direction] of CITATIONS) {
    const links = await engine.citationLinks(doi, direction);
    if (links.length > MAX_LINKS) {
      console.log(`${direction} of ${doi}: ${links.length} links, over ${MAX_LINKS}: not recorded`);
      continue;
    }
    fixtures.citations[citationKey(doi, direction)] = links;
    for (const link of links.slice(0, FIRST_PAGE)) for (const d of link.dois) wanted.add(d);
    console.log(`${direction} of ${doi}: ${links.length} links`);
  }
  const { found, unasked } = await engine.resolveDois([...wanted]);
  for (const paper of found.values()) fixtures.papers[paper.id] ??= paper;
  console.log(`${found.size} of ${wanted.size} DOIs resolved to records${unasked.length ? `; ${unasked.length} not asked (OpenAlex failed or cooled down)` : ''}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
