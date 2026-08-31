/**
 * What CORE costs on a DOI lookup, and what it buys.
 *
 * Phase 10 recorded the cost and left the other half open: "whether that is
 * worth 7 seconds on every DOI lookup has not been measured and should be
 * before this is called settled." This measures both sides of that sentence.
 *
 *   pnpm --filter @open-access-explorer/api exec tsx scripts/core-doi-cost.ts
 *   ... --dois=12          how many DOIs to sample
 *   ... --timeout=20000    per-provider budget, matching the orchestrator
 *
 * Method. DOIs are drawn from live keyword searches rather than chosen, so the
 * sample is the kind of paper a user actually clicks. Each one is then looked
 * up twice through the real search path: once without CORE, once with. No
 * provider cache, so both runs fetch.
 *
 * The without-CORE run goes FIRST on purpose. Whatever upstream warming the
 * first run causes benefits the second, so any latency gap this reports is the
 * conservative one — the real cost of CORE is at least this and probably more.
 *
 * The question is not whether CORE returns something. It is whether CORE
 * returns a readable copy that nothing else in the fan-out found, *after*
 * Unpaywall has enriched the page — because Unpaywall supplies `fullText` too,
 * and a copy it would have found anyway is not worth waiting for.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import type { Paper } from '@open-access-explorer/shared';
import { search, parseQuery, PROVIDERS } from '../src/orchestrator';
import { AUTHORITIES } from '../src/authorities';

const QUERIES = [
  'crispr gene editing',
  'alzheimer amyloid beta',
  'antibiotic resistance mechanisms',
  'gut microbiome obesity',
  'sars-cov-2 spike protein'
];

const arg = (name: string, fallback: number) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const USER_AGENT = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL ?? 'your-email@example.com'})`;

const WITHOUT_CORE = PROVIDERS.filter(p => p.id !== 'core');

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** A copy someone could actually open. */
const readable = (paper: Paper | undefined) => Boolean(paper?.fullText?.url);

type Row = {
  doi: string;
  withoutMs: number;
  withMs: number;
  /** CORE's own reported latency inside the with-CORE fan-out. */
  coreMs: number;
  coreStatus: string;
  readableWithout: boolean;
  readableWith: boolean;
  /** Which provider or authority supplied the copy, when there is one. */
  fullTextSource?: string;
};

async function lookup(doi: string, providers: readonly typeof PROVIDERS[number][]) {
  const startedAt = Date.now();
  const result = await search(parseQuery(doi), {
    providers,
    authorities: AUTHORITIES,
    pageSize: 5,
    userAgent: USER_AGENT
  });
  return { result, elapsed: Date.now() - startedAt };
}

async function collectDois(want: number): Promise<string[]> {
  const dois: string[] = [];

  for (const query of QUERIES) {
    if (dois.length >= want) break;
    const res = await search(parseQuery(query), {
      providers: WITHOUT_CORE,
      authorities: [],
      pageSize: 20,
      userAgent: USER_AGENT
    });
    for (const paper of res.papers) {
      if (paper.doi && !dois.includes(paper.doi)) dois.push(paper.doi);
      if (dois.length >= want) break;
    }
  }

  return dois.slice(0, want);
}

async function main() {
  const want = arg('dois', 12);

  console.log(`Collecting ${want} DOIs from live searches (CORE excluded, it has no keyword search)…`);
  const dois = await collectDois(want);
  console.log(`Got ${dois.length}.\n`);

  const rows: Row[] = [];

  for (const [i, doi] of dois.entries()) {
    process.stdout.write(`[${i + 1}/${dois.length}] ${doi} … `);

    // Without CORE first: any upstream warming then favours the with-CORE run,
    // which makes the reported cost of CORE a floor rather than a ceiling.
    const without = await lookup(doi, WITHOUT_CORE);
    const withCore = await lookup(doi, PROVIDERS);

    const paperWithout = without.result.papers[0];
    const paperWith = withCore.result.papers[0];
    const coreReport = withCore.result.reports.find(r => r.provider === 'core');

    const row: Row = {
      doi,
      withoutMs: without.elapsed,
      withMs: withCore.elapsed,
      coreMs: coreReport?.latency ?? 0,
      coreStatus: coreReport?.status ?? 'absent',
      readableWithout: readable(paperWithout),
      readableWith: readable(paperWith),
      ...(paperWith?.fieldSources?.fullText
        ? { fullTextSource: String(paperWith.fieldSources.fullText) }
        : {})
    };

    // The first version of this script asked `parseQuery` for `doi:<doi>`,
    // which is not a form it recognises, so every lookup ran as a keyword
    // search and CORE was skipped in *both* arms — producing a latency table
    // that looked like a comparison and was not one. Refuse to continue rather
    // than print numbers that measure nothing.
    if (row.coreStatus === 'skipped' || row.coreStatus === 'absent') {
      console.error(
        `\n  CORE was ${row.coreStatus} in the with-CORE arm — the two runs are identical ` +
          `and nothing here measures CORE. Check that the query parsed as a DOI.`
      );
      process.exit(1);
    }

    rows.push(row);
    console.log(
      `without ${row.withoutMs}ms, with ${row.withMs}ms (core ${row.coreMs}ms ${row.coreStatus})` +
        `${row.readableWith && !row.readableWithout ? '  ← CORE supplied the only copy' : ''}`
    );
  }

  const found = rows.filter(r => r.coreStatus !== 'absent');
  const soleSupplier = rows.filter(r => r.readableWith && !r.readableWithout);

  console.log('\n─────────────────────────────────────────────');
  console.log(`DOIs measured                 ${rows.length}`);
  console.log(`Median latency without CORE   ${median(rows.map(r => r.withoutMs))} ms`);
  console.log(`Median latency with CORE      ${median(rows.map(r => r.withMs))} ms`);
  console.log(`Median CORE's own latency     ${median(found.map(r => r.coreMs))} ms`);
  console.log(`CORE status counts            ${JSON.stringify(
    found.reduce<Record<string, number>>((acc, r) => {
      acc[r.coreStatus] = (acc[r.coreStatus] ?? 0) + 1;
      return acc;
    }, {})
  )}`);
  console.log(`Readable copy without CORE    ${rows.filter(r => r.readableWithout).length}/${rows.length}`);
  console.log(`Readable copy with CORE       ${rows.filter(r => r.readableWith).length}/${rows.length}`);
  console.log(`CORE was the only supplier    ${soleSupplier.length}/${rows.length}`);
  console.log(`fullText sources              ${JSON.stringify(
    rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.fullTextSource ?? 'none';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  )}`);
  console.log('─────────────────────────────────────────────');

  if (soleSupplier.length > 0) {
    console.log('\nDOIs where only CORE found a copy:');
    for (const r of soleSupplier) console.log(`  ${r.doi}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
