/**
 * Every tool once, against the live sources, through the built stdio binary.
 * Exits 1 if any call fails or answers something implausible. Ten upstream
 * APIs drift; this is how that is found out before a user does. Nightly, never
 * on a pull request: it needs the network, and an outage upstream must not
 * block a merge.
 *
 *   pnpm --filter sci-open-mcp exec tsx scripts/smoke.ts   (after a build)
 */
import path from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

type Structured = Record<string, any>;

async function main(): Promise<void> {
  const client = new Client({ name: 'sci-open-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'dist', 'bin', 'stdio.js'), '--toolsets', 'all'],
    env: { ...process.env, SCI_OPEN_LOG_LEVEL: 'warn' } as Record<string, string>
  }));

  const failures: string[] = [];
  const call = async (name: string, args: Record<string, unknown>, plausible: (s: Structured) => boolean): Promise<Structured | undefined> => {
    const started = Date.now();
    const result = await client.callTool({ name, arguments: args }, { timeout: 120_000 });
    const structured = result.structuredContent as Structured | undefined;
    let ok = false;
    try {
      ok = !result.isError && structured !== undefined && plausible(structured);
    } catch {
      ok = false;
    }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(args).slice(0, 80)} ${Date.now() - started} ms`);
    if (!ok) failures.push(`${name}: ${JSON.stringify(result.content).slice(0, 500)}`);
    return structured;
  };

  // A PLOS paper in Europe PMC's open subset, and a closed one.
  const PLOS = '10.1371/journal.pone.0000217';
  const query = 'TS=crispr AND PY=2023';
  await call('search_papers', { query, count_only: true }, s => s.counts.largest.count > 0);
  const page = await call('search_papers', { query, page_size: 3 }, s => s.results.length > 0);
  if (page?.handle) await call('get_search_page', { handle: page.handle, page: 2 }, s => s.results.length > 0 && s.rerun === undefined);
  await call('get_paper', { doi: PLOS }, s => s.paper.title.length > 0);
  await call('get_paper', { id: 'arxiv:1706.03762' }, s => /attention/i.test(s.paper.title));
  // Europe PMC holds this one open: the JATS tier, real sections.
  const outline = await call('read_paper', { paper: PLOS, view: 'outline' }, s => s.tier === 'europepmc-jats' && s.outline.length > 3);
  const section = outline?.outline?.find((s: { chars: number }) => s.chars > 0)?.id;
  if (section) await call('read_paper', { paper: PLOS, view: 'section', section }, s => s.section.text.length > 0);
  await call('verify_references', {
    references: [
      'Vaswani A, et al. Attention is all you need. 2017. arXiv:1706.03762',
      'Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature 2021;590:112-118.'
    ]
  }, s => s.results[0].verdict === 'verified' && s.results[1].verdict === 'not_found');

  // Its references and citers are stable: published in 2021, cited since.
  const PEERJ = '10.7717/peerj-cs.421';
  await call('get_citations', { paper: PEERJ, direction: 'references', limit: 5 },
    s => s.total_links > 20 && s.links.some((l: Structured) => l.record?.title));
  await call('get_citations', { paper: PEERJ, direction: 'cited_by', limit: 5 }, s => s.total_links > 0);
  await call('export_citations', { papers: [PEERJ, PLOS, 'arxiv:1706.03762'] },
    s => s.entries === 3 && s.unresolved.length === 0 && typeof s.resource_uri === 'string');

  await client.close();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
