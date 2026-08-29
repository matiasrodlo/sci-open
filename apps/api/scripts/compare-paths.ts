/**
 * Runs one query set through both search paths and diffs what comes back.
 *
 * This is the evidence phase 07 exists to produce. The flag makes the new path
 * runnable; this says whether it is *better*, which is a different question and
 * the only one worth flipping a default on.
 *
 *   pnpm --filter @open-access-explorer/api exec tsx scripts/compare-paths.ts
 *   ... --queries=5          run only the first five
 *   ... --page-size=200      how many records to compare per query
 *   ... --out=compare.json   where the raw results are written
 *   ... --load=compare.json  re-report from a previous run, no network
 *
 * Both paths are called in process rather than over HTTP. Going through the
 * route would put the response cache between the harness and the thing being
 * measured — the second path to run would be compared against a cached copy of
 * itself — and would need two servers with different flags to compare at all.
 *
 * Read the report knowing that the new path has one provider and the old has
 * nine. It will lose on raw count, and that is arithmetic, not a regression.
 * The comparison that means something today is the Europe PMC slice, where both
 * paths are answering from the same corpus.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { toOARecord } from '@open-access-explorer/shared';
import type { OARecord, ProviderTotal, SearchParams, SearchResponse } from '@open-access-explorer/shared';
import { EnhancedSearchPipeline } from '../src/lib/enhanced-search-pipeline';
import { EuropePMCConnector } from '../src/sources/europepmc';
import * as newEuropePmc from '../src/providers/europepmc';
import { ProviderCache, parseQuery } from '../src/orchestrator';
import { runOrchestrator } from '../src/orchestrator/from-search-params';

/**
 * Twenty queries, chosen to exercise the parts that differ rather than to be
 * representative of traffic — there is no traffic yet.
 *
 * Mostly biomedical, because Europe PMC is the only migrated provider and a
 * query it cannot answer measures nothing about the new path's merge, rank or
 * policy code. The three off-domain queries are in deliberately: they are where
 * the one-provider coverage gap shows up as a number instead of a caveat.
 */
const QUERIES: Array<{ label: string; params: SearchParams; note?: string }> = [
  { label: 'crispr gene editing', params: { q: 'crispr gene editing' } },
  { label: 'single cell rna seq (phrase)', params: { q: '"single cell rna sequencing"' }, note: 'phrase must survive translation' },
  { label: 'alzheimer amyloid beta', params: { q: 'alzheimer amyloid beta' } },
  { label: 'sars-cov-2 spike protein', params: { q: 'sars-cov-2 spike protein' } },
  { label: 'antibiotic resistance', params: { q: 'antibiotic resistance mechanisms' } },
  { label: 'cardiac regeneration', params: { q: 'cardiac regeneration stem cells' } },
  { label: 'gut microbiome obesity', params: { q: '"gut microbiome" obesity' }, note: 'phrase + bare term' },
  { label: 'malaria vaccine efficacy', params: { q: 'malaria vaccine efficacy' } },
  { label: 'tumor immunotherapy', params: { q: 'tumor immunotherapy checkpoint' } },
  { label: 'crispr (single term)', params: { q: 'crispr' }, note: 'broad, tests depth not precision' },
  { label: 'p53 mutation cancer', params: { q: 'p53 mutation cancer' } },
  { label: 'mrna vaccine delivery', params: { q: 'mrna vaccine delivery' } },
  { label: 'deep learning radiology', params: { q: '"deep learning" radiology' } },
  { label: 'antimicrobial peptides', params: { q: 'antimicrobial peptides' } },
  { label: 'mitochondria parkinson', params: { q: 'mitochondrial dysfunction parkinson' } },
  { label: 'progeria (rare term)', params: { q: '"hutchinson-gilford progeria"' }, note: 'small result set' },
  { label: 'year-bounded crispr', params: { q: 'crispr', filters: { yearFrom: 2022, yearTo: 2024 } }, note: 'year filter, expressed upstream by the new path' },
  { label: 'sort by citations', params: { q: 'crispr gene editing', sort: 'citations' }, note: 'ordering, not retrieval' },
  { label: 'DOI lookup', params: { q: '10.1038/s41586-020-2008-3' }, note: 'single record, both paths' },
  { label: 'quantum error correction', params: { q: 'quantum error correction' }, note: 'off-domain: coverage gap' },
  { label: 'transformer attention', params: { q: '"transformer architecture" attention' }, note: 'off-domain: coverage gap' },
  { label: 'climate model uncertainty', params: { q: 'climate model uncertainty' }, note: 'off-domain: coverage gap' }
];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const LIMIT = Number(flag('queries') ?? QUERIES.length);
// Large on purpose. Both paths fetch their full depth and then slice, so asking
// for a big page costs no extra network and turns overlap into a comparison of
// result *sets* rather than of two page-ones — which would measure ranking
// agreement and report it as coverage.
const PAGE_SIZE = Number(flag('page-size') ?? 5000);
/** What a user actually sees first. Ordering is judged here, not over the set. */
const TOP_N = 20;
const OUT = flag('out') ?? path.resolve(__dirname, 'compare-paths.json');
const LOAD = flag('load');

const userAgent = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'compare@example.com'})`;

// Built with the options the server builds it with, so the thing measured is
// the thing that runs.
const pipeline = new EnhancedSearchPipeline({
  userAgent,
  maxResults: parseInt(process.env.SEARCH_MAX_FETCH_DEPTH || '600'),
  enableEnrichment: true,
  enablePdfResolution: true,
  enableCitations: false
});

// One cache for the whole sweep, matching the server, where it lives for the
// process. Queries in this set do not repeat, so it changes no measurement —
// it is here so the harness is not quietly a different configuration.
const providerCache = new ProviderCache();

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * What makes two records the same paper across two paths that build `id`
 * differently. DOI when there is one; otherwise the title, flattened, which
 * over-matches on rare occasions and is still the only other thing both shapes
 * carry.
 */
function paperKey(record: OARecord): string {
  const doi = record.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (doi) return `doi:${doi}`;
  const title = (record.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // An untitled record matches nothing but itself. Keying it on the empty
  // string would make every untitled record the same paper and inflate the
  // overlap with pure noise.
  if (!title) return `id:${record.source}:${record.sourceId ?? record.id}`;
  return `title:${title}`;
}

/**
 * Rank correlation over the records both paths returned, +1 for identical
 * order and -1 for reversed. Positions in a list, so there are no ties and the
 * short formula applies.
 */
function spearman(pairs: Array<[number, number]>): number | undefined {
  const n = pairs.length;
  if (n < 2) return undefined;
  const sumD2 = pairs.reduce((acc, [a, b]) => acc + (a - b) ** 2, 0);
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

const COMPLETENESS_FIELDS = ['doi', 'venue', 'publisher', 'abstract', 'year', 'citationCount', 'topics', 'landingPage'] as const;
type CompletenessField = typeof COMPLETENESS_FIELDS[number];

function completeness(records: OARecord[]): Record<CompletenessField, number> {
  const out = {} as Record<CompletenessField, number>;
  for (const field of COMPLETENESS_FIELDS) {
    const populated = records.filter(r => {
      const value = (r as any)[field];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }).length;
    out[field] = records.length ? populated / records.length : 0;
  }
  return out;
}

type Side = {
  total: number;
  returned: number;
  wallMs: number;
  reportedMs?: number;
  providerTotals: ProviderTotal[];
  keys: string[];
  completeness: Record<CompletenessField, number>;
  error?: string;
};

/**
 * One provider, both implementations, called directly.
 *
 * The whole-path numbers cannot isolate Europe PMC. The old merger re-stamps a
 * merged record with the highest-priority source in the group — Crossref,
 * OpenAlex and Unpaywall all outrank Europe PMC — so filtering its output on
 * `source === 'europepmc'` returns only the records *no other provider had*,
 * which reads as a contribution of nearly zero and is not one. Asking the two
 * connectors the same question directly is the only like-for-like available.
 */
type ConnectorSide = {
  returned: number;
  totalHits?: number;
  wallMs: number;
  keys: string[];
  completeness: Record<CompletenessField, number>;
  error?: string;
};

type Row = {
  label: string;
  note?: string;
  old: Side;
  new: Side;
  connector: { old: ConnectorSide; new: ConnectorSide };
};

const EMPTY_SIDE = (error: string): Side => ({
  total: 0, returned: 0, wallMs: 0, providerTotals: [], keys: [],
  completeness: completeness([]), error
});

function sideOf(response: SearchResponse, wallMs: number): Side {
  const hits = response.hits ?? [];
  return {
    total: response.total ?? 0,
    returned: hits.length,
    wallMs,
    ...(response.duration !== undefined ? { reportedMs: response.duration } : {}),
    providerTotals: response.providerTotals ?? [],
    keys: hits.map(paperKey),
    completeness: completeness(hits)
  };
}

async function timed(work: () => Promise<SearchResponse>): Promise<{ side: Side; hits: OARecord[] }> {
  const startedAt = Date.now();
  try {
    const response = await work();
    return { side: sideOf(response, Date.now() - startedAt), hits: response.hits ?? [] };
  } catch (error: any) {
    return { side: { ...EMPTY_SIDE(error?.message ?? String(error)), wallMs: Date.now() - startedAt }, hits: [] };
  }
}

const CONNECTOR_DEPTH = 200;
const oldEuropePmc = new EuropePMCConnector();

/** Both Europe PMC implementations, same query, same depth, no orchestration. */
async function compareConnectors(params: SearchParams): Promise<{ old: ConnectorSide; new: ConnectorSide }> {
  const filters = params.filters ?? {};
  const query = parseQuery(params.doi ?? params.q ?? '', {
    ...(filters.yearFrom !== undefined || filters.yearTo !== undefined
      ? {
          years: {
            ...(filters.yearFrom !== undefined ? { from: filters.yearFrom } : {}),
            ...(filters.yearTo !== undefined ? { to: filters.yearTo } : {})
          }
        }
      : {})
  });

  const sideOfRecords = (records: OARecord[], wallMs: number, totalHits?: number): ConnectorSide => ({
    returned: records.length,
    ...(totalHits !== undefined ? { totalHits } : {}),
    wallMs,
    keys: records.map(paperKey),
    completeness: completeness(records)
  });

  const emptyConnector = (error: string, wallMs: number): ConnectorSide => ({
    returned: 0, wallMs, keys: [], completeness: completeness([]), error
  });

  // The old connector takes the raw text, which is the whole point of the
  // Query type: it has no way to know `"gut microbiome"` is a phrase.
  let oldSide: ConnectorSide;
  const oldStarted = Date.now();
  try {
    const result = await oldEuropePmc.search({
      ...(params.doi ? { doi: params.doi } : { titleOrKeywords: params.q ?? '' }),
      ...(filters.yearFrom !== undefined ? { yearFrom: filters.yearFrom } : {}),
      ...(filters.yearTo !== undefined ? { yearTo: filters.yearTo } : {}),
      limit: CONNECTOR_DEPTH
    });
    oldSide = sideOfRecords(result.records, Date.now() - oldStarted, result.totalHits);
  } catch (error: any) {
    oldSide = emptyConnector(error?.message ?? String(error), Date.now() - oldStarted);
  }

  let newSide: ConnectorSide;
  const newStarted = Date.now();
  try {
    const result = await newEuropePmc.search(query, {
      pageSize: CONNECTOR_DEPTH,
      openAccessOnly: true,
      timeoutMs: 30000,
      userAgent
    });
    // Compared as OARecords: that is the shape the response contract carries,
    // so it is what a consumer would actually receive from either path.
    newSide = sideOfRecords(result.papers.map(toOARecord), Date.now() - newStarted, result.totalHits);
  } catch (error: any) {
    newSide = emptyConnector(error?.message ?? String(error), Date.now() - newStarted);
  }

  return { old: oldSide, new: newSide };
}

async function runOne(entry: typeof QUERIES[number]): Promise<Row> {
  const params: SearchParams = { ...entry.params, page: 1, pageSize: PAGE_SIZE };

  // Sequential, and the old path first each time, so neither benefits from
  // upstream caches the other warmed.
  const oldRun = await timed(() => pipeline.search(params));
  const newRun = await timed(() => runOrchestrator(params, { cache: providerCache, userAgent }));
  const connector = await compareConnectors(params);

  return {
    label: entry.label,
    ...(entry.note ? { note: entry.note } : {}),
    old: oldRun.side,
    new: newRun.side,
    connector
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const num = (n: number) => n.toLocaleString('en-US');

function overlapOf(a: string[], b: string[]) {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter(k => setB.has(k));
  const union = new Set([...setA, ...setB]).size;
  return {
    shared: shared.length,
    jaccard: union ? shared.length / union : 0,
    ofOld: setA.size ? shared.length / setA.size : 0,
    ofNew: setB.size ? shared.length / setB.size : 0,
    sharedKeys: shared
  };
}

function orderingOf(oldKeys: string[], newKeys: string[], shared: string[]) {
  const oldRank = new Map(oldKeys.map((k, i) => [k, i]));
  const newRank = new Map(newKeys.map((k, i) => [k, i]));

  // Re-ranked within the shared set, 0..n-1 on both sides. Raw positions are
  // not comparable: a record at 40 of 200 and at 40 of 60 are not in the same
  // place, and the lists are routinely different lengths.
  const denseBy = (rank: Map<string, number>) => {
    const ordered = [...shared].sort((a, b) => rank.get(a)! - rank.get(b)!);
    return new Map(ordered.map((k, i) => [k, i]));
  };
  const oldDense = denseBy(oldRank);
  const newDense = denseBy(newRank);

  const rho = spearman(shared.map(k => [oldDense.get(k)!, newDense.get(k)!] as [number, number]));

  // How much of the old path's first page survives into the new path's first
  // page. Rank correlation over a whole set can look healthy while the records
  // a user actually sees have all changed.
  const newTop = new Set(newKeys.slice(0, TOP_N));
  const topNRetained = oldKeys.slice(0, TOP_N).filter(k => newTop.has(k)).length;
  return { rho, topNRetained };
}

function report(rows: Row[]): void {
  const line = (s = '') => console.log(s);

  line();
  line('='.repeat(96));
  line(`  SEARCH PATH COMPARISON — ${rows.length} queries, full result sets (cap ${num(PAGE_SIZE)})`);
  line('='.repeat(96));

  // --- Whole-path -----------------------------------------------------------
  line();
  line('WHOLE PATH — old (9 providers) vs new (Europe PMC only)');
  line('-'.repeat(96));
  line(
    'query'.padEnd(29) + 'old'.padStart(8) + 'new'.padStart(8) + 'shared'.padStart(8) +
    'of new'.padStart(8) + `top${TOP_N}`.padStart(7) + 'rho'.padStart(7) +
    'old ms'.padStart(9) + 'new ms'.padStart(9)
  );

  for (const row of rows) {
    const o = overlapOf(row.old.keys, row.new.keys);
    const ord = orderingOf(row.old.keys, row.new.keys, o.sharedKeys);
    line(
      row.label.slice(0, 28).padEnd(29) +
      num(row.old.total).padStart(8) +
      num(row.new.total).padStart(8) +
      num(o.shared).padStart(8) +
      pct(o.ofNew).padStart(8) +
      `${ord.topNRetained}/${TOP_N}`.padStart(7) +
      (ord.rho === undefined ? '—'.padStart(7) : ord.rho.toFixed(2).padStart(7)) +
      num(row.old.wallMs).padStart(9) +
      num(row.new.wallMs).padStart(9) +
      (row.old.error || row.new.error ? '  ERR' : '')
    );
  }

  // --- Europe PMC like-for-like --------------------------------------------
  line();
  line('  `old` and `new` are the reported totals, which are what each path holds');
  line('  after filtering, not what the corpus contains. Both read 600 deep per');
  line('  provider, so both are floors — the old path just has nine providers of');
  line('  it to merge and the new path has one.');

  line();
  line(`EUROPE PMC — old connector vs new provider, called directly, depth ${CONNECTOR_DEPTH}`);
  line('-'.repeat(96));
  line(
    'query'.padEnd(29) + 'old'.padStart(8) + 'new'.padStart(8) + 'shared'.padStart(8) +
    'of old'.padStart(8) + 'of new'.padStart(8) + 'rho'.padStart(7) +
    'old hits'.padStart(11) + 'new hits'.padStart(11)
  );

  for (const row of rows) {
    const o = overlapOf(row.connector.old.keys, row.connector.new.keys);
    const ord = orderingOf(row.connector.old.keys, row.connector.new.keys, o.sharedKeys);
    line(
      row.label.slice(0, 28).padEnd(29) +
      num(row.connector.old.returned).padStart(8) +
      num(row.connector.new.returned).padStart(8) +
      num(o.shared).padStart(8) +
      pct(o.ofOld).padStart(8) +
      pct(o.ofNew).padStart(8) +
      (ord.rho === undefined ? '—'.padStart(7) : ord.rho.toFixed(2).padStart(7)) +
      (row.connector.old.totalHits === undefined ? '—' : num(row.connector.old.totalHits)).padStart(11) +
      (row.connector.new.totalHits === undefined ? '—' : num(row.connector.new.totalHits)).padStart(11) +
      (row.connector.old.error || row.connector.new.error ? '  ERR' : '')
    );
  }

  // --- Field completeness ---------------------------------------------------
  line();
  line('FIELD COMPLETENESS — share of returned records with the field populated');
  line('-'.repeat(96));

  const pooled = (pick: (r: Row) => { completeness: Record<CompletenessField, number>; returned: number }) => {
    const out = {} as Record<CompletenessField, number>;
    for (const field of COMPLETENESS_FIELDS) {
      let populated = 0;
      let total = 0;
      for (const row of rows) {
        const side = pick(row);
        populated += side.completeness[field] * side.returned;
        total += side.returned;
      }
      out[field] = total ? populated / total : 0;
    }
    return out;
  };

  const oldAll = pooled(r => r.old);
  const newAll = pooled(r => r.new);
  const oldConn = pooled(r => r.connector.old);
  const newConn = pooled(r => r.connector.new);

  line(
    'field'.padEnd(16) + 'old path'.padStart(10) + 'new path'.padStart(10) +
    '     ' + 'epmc old'.padStart(10) + 'epmc new'.padStart(10) + '   delta (epmc)'
  );
  for (const field of COMPLETENESS_FIELDS) {
    // The delta that means something is the connector one: same corpus, same
    // records, so a difference is the normaliser and nothing else.
    const delta = newConn[field] - oldConn[field];
    const mark = Math.abs(delta) < 0.005 ? '=' : delta > 0 ? '+' : '-';
    line(
      field.padEnd(16) +
      pct(oldAll[field]).padStart(10) +
      pct(newAll[field]).padStart(10) +
      '     ' +
      pct(oldConn[field]).padStart(10) +
      pct(newConn[field]).padStart(10) +
      `   ${mark}${pct(Math.abs(delta)).padStart(5)}`
    );
  }

  // --- Per-provider contribution -------------------------------------------
  line();
  line('PER-PROVIDER CONTRIBUTION — records retrieved across the sweep');
  line('-'.repeat(96));

  const contribution = (pick: (r: Row) => ProviderTotal[]) => {
    const totals = new Map<string, { retrieved: number; errors: number; queries: number }>();
    for (const row of rows) {
      for (const t of pick(row)) {
        const entry = totals.get(t.source) ?? { retrieved: 0, errors: 0, queries: 0 };
        entry.retrieved += t.retrieved ?? 0;
        entry.queries += 1;
        if (t.error) entry.errors += 1;
        totals.set(t.source, entry);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1].retrieved - a[1].retrieved);
  };

  line('OLD PATH');
  for (const [source, t] of contribution(r => r.old.providerTotals)) {
    line(`  ${source.padEnd(16)}${num(t.retrieved).padStart(9)} retrieved   ${t.queries} queries   ${t.errors} errored`);
  }
  line('NEW PATH');
  for (const [source, t] of contribution(r => r.new.providerTotals)) {
    line(`  ${source.padEnd(16)}${num(t.retrieved).padStart(9)} retrieved   ${t.queries} queries   ${t.errors} errored`);
  }

  // --- Latency --------------------------------------------------------------
  const latencies = (pick: (r: Row) => Side) => {
    const values = rows.map(r => pick(r).wallMs).sort((a, b) => a - b);
    const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0;
    return {
      median: at(0.5),
      p90: at(0.9),
      max: values[values.length - 1] ?? 0,
      mean: values.reduce((a, b) => a + b, 0) / (values.length || 1)
    };
  };

  const oldLat = latencies(r => r.old);
  const newLat = latencies(r => r.new);

  line();
  line('LATENCY — wall clock per query, milliseconds');
  line('-'.repeat(96));
  line('path'.padEnd(12) + 'median'.padStart(10) + 'mean'.padStart(10) + 'p90'.padStart(10) + 'max'.padStart(10));
  line('old'.padEnd(12) + num(oldLat.median).padStart(10) + num(Math.round(oldLat.mean)).padStart(10) + num(oldLat.p90).padStart(10) + num(oldLat.max).padStart(10));
  line('new'.padEnd(12) + num(newLat.median).padStart(10) + num(Math.round(newLat.mean)).padStart(10) + num(newLat.p90).padStart(10) + num(newLat.max).padStart(10));

  // --- Totals ---------------------------------------------------------------
  const sum = (pick: (r: Row) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const wholeShared = sum(r => overlapOf(r.old.keys, r.new.keys).shared);
  const newInOld = (() => {
    const newCount = sum(r => r.new.returned);
    return newCount ? wholeShared / newCount : 0;
  })();
  const connShared = sum(r => overlapOf(r.connector.old.keys, r.connector.new.keys).shared);
  const connOldCount = sum(r => r.connector.old.returned);
  const connNewCount = sum(r => r.connector.new.returned);

  line();
  line('SUMMARY');
  line('-'.repeat(96));
  line(`  Reported total, old / new        ${num(sum(r => r.old.total))} / ${num(sum(r => r.new.total))}`);
  line(`  Records returned, old / new      ${num(sum(r => r.old.returned))} / ${num(sum(r => r.new.returned))}`);
  line(`  Shared across the whole path     ${num(wholeShared)}  (${pct(newInOld)} of what the new path returned)`);
  line(`  Europe PMC direct, old / new     ${num(connOldCount)} / ${num(connNewCount)} records, ${num(connShared)} shared`);
  line(`    ... of the old connector's     ${pct(connOldCount ? connShared / connOldCount : 0)}`);
  line(`    ... of the new provider's      ${pct(connNewCount ? connShared / connNewCount : 0)}`);
  line(`  Errored queries, old / new       ${rows.filter(r => r.old.error).length} / ${rows.filter(r => r.new.error).length}`);
  line();
}

// ---------------------------------------------------------------------------

async function main() {
  if (LOAD) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(LOAD), 'utf8'));
    report(raw.rows as Row[]);
    return;
  }

  const selected = QUERIES.slice(0, LIMIT);
  const rows: Row[] = [];

  for (const [index, entry] of selected.entries()) {
    process.stderr.write(`[${index + 1}/${selected.length}] ${entry.label} ... `);
    const row = await runOne(entry);
    process.stderr.write(
      `old ${row.old.error ? 'ERR' : `${row.old.total} in ${row.old.wallMs}ms`}, ` +
      `new ${row.new.error ? 'ERR' : `${row.new.total} in ${row.new.wallMs}ms`}\n`
    );
    rows.push(row);
  }

  fs.writeFileSync(OUT, JSON.stringify({ pageSize: PAGE_SIZE, recordedAt: new Date().toISOString(), rows }, null, 2));
  process.stderr.write(`\nRaw results -> ${OUT}\n`);

  report(rows);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
