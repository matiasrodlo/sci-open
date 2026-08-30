/**
 * Measures what enrichment is worth on a real page of results.
 *
 * Phase 09's acceptance criteria are all statements about a page that came
 * back from live services — field provenance, DOI resolution, download success
 * and whether the citations sort has data — so they are measured against one
 * rather than asserted against stubs. The unit tests assert the mechanism;
 * this says whether the mechanism bought anything.
 *
 *   pnpm --filter @open-access-explorer/api exec tsx scripts/enrichment-report.ts
 *   ... --queries=3        how many of the query set to run
 *   ... --page-size=20     records per page
 *   ... --no-download      skip the PDF fetches, which are the slow part
 *
 * The download check fetches the first bytes of each advertised copy with the
 * proxy's own headers and asks whether a PDF came back.
 *
 * It is deliberately careful about how it does that, because a first attempt
 * measured the enriched page as *worse* — 55% against 64% — and the cause was
 * the harness rather than the code. Probing the before and after pages
 * concurrently sends two requests to the same publisher at the same moment for
 * every paper whose copy did not change, and publishers answer the second one
 * 403. So every distinct URL is fetched exactly once, requests to one host are
 * serialised, and the two pages are scored from that shared set of results.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import axios from 'axios';
import type { Paper } from '@open-access-explorer/shared';
import { search, parseQuery, ProviderCache } from '../src/orchestrator';
import { AUTHORITIES } from '../src/authorities';
import { EnhancedSearchPipeline } from '../src/lib/enhanced-search-pipeline';

const QUERIES = [
  'crispr gene editing',
  'alzheimer amyloid beta',
  'antibiotic resistance mechanisms',
  '"gut microbiome" obesity',
  'sars-cov-2 spike protein'
];

const arg = (name: string, fallback: number) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const USER_AGENT = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL ?? 'your-email@example.com'})`;

const FIELDS = ['title', 'abstract', 'authors', 'year', 'venue', 'publisher',
  'topics', 'language', 'citationCount', 'oaStatus', 'fullText', 'landingPage'] as const;

function coverage(papers: readonly Paper[]) {
  const filled = (p: Paper, f: string) => {
    const v = (p as any)[f];
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (f === 'oaStatus') return v !== 'unknown';
    return true;
  };
  return Object.fromEntries(FIELDS.map(f => [f, papers.filter(p => filled(p, f)).length]));
}

/** One in-flight request per host, so the probe cannot rate-limit itself. */
const hostQueues = new Map<string, Promise<unknown>>();

function perHost<T>(url: string, work: () => Promise<T>): Promise<T> {
  let host: string;
  try { host = new URL(url).hostname; } catch { host = url; }
  const queued = (hostQueues.get(host) ?? Promise.resolve()).then(work, work);
  hostQueues.set(host, queued.catch(() => undefined));
  return queued;
}

/** Fetches the first bytes the proxy would and says whether a PDF arrived. */
async function servesPdf(url: string): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxRedirects: 10,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*' },
      validateStatus: s => s < 400,
      // Enough to see the magic number without pulling the file.
      maxContentLength: 4096
    });
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    const head = Buffer.from(response.data as ArrayBuffer).subarray(0, 4).toString('latin1');
    return type.startsWith('application/pdf') || head === '%PDF';
  } catch (error: any) {
    // A size cap trips once the body starts arriving, which means it arrived.
    if (String(error?.message ?? '').includes('maxContentLength')) return true;
    return false;
  }
}

async function main() {
  const queries = QUERIES.slice(0, arg('queries', 3));
  const pageSize = arg('page-size', 20);
  const download = !process.argv.includes('--no-download');
  const cache = new ProviderCache();

  let bare = 0, enriched = 0;
  let bareDownloads = 0, bareTested = 0, richDownloads = 0, richTested = 0;
  let oldDownloads = 0, oldTested = 0;
  const pipeline = new EnhancedSearchPipeline({ userAgent: USER_AGENT });
  const bareCoverage: Record<string, number> = {};
  const richCoverage: Record<string, number> = {};
  const provenance = new Map<string, number>();

  for (const q of queries) {
    console.log(`\n=== ${q} ===`);

    // The same search twice: once with the authorities off, once on. The
    // provider cache is shared, so the fan-out happens once and the only
    // difference between the two pages is enrichment.
    const before = await search(parseQuery(q), { pageSize, cache, userAgent: USER_AGENT, authorities: [] });
    const after = await search(parseQuery(q), { pageSize, cache, userAgent: USER_AGENT, authorities: AUTHORITIES });

    bare += before.papers.length;
    enriched += after.papers.length;
    for (const [field, n] of Object.entries(coverage(before.papers))) bareCoverage[field] = (bareCoverage[field] ?? 0) + n;
    for (const [field, n] of Object.entries(coverage(after.papers))) richCoverage[field] = (richCoverage[field] ?? 0) + n;

    for (const paper of after.papers) {
      for (const [field, from] of Object.entries(paper.fieldSources)) {
        provenance.set(`${field}<-${from}`, (provenance.get(`${field}<-${from}`) ?? 0) + 1);
      }
    }

    for (const report of after.authorities) {
      console.log(`  ${report.authority.padEnd(14)} ${report.status.padEnd(8)} asked ${String(report.asked).padStart(3)}  answered ${String(report.answered).padStart(3)}  applied ${String(report.applied).padStart(4)}  ${report.latency}ms`);
    }

    const multi = after.papers.filter(p => Object.keys(p.fieldSources).length >= 2);
    console.log(`  papers ${after.papers.length}, of which ${multi.length} carry two or more attributed fields`);

    if (download) {
      // Both pages, so the number has something to be an improvement over.
      // Same papers in the same order; only the advertised copy differs, and
      // for most papers it does not differ at all — hence one fetch per
      // distinct URL rather than one per paper per page.
      // The criterion names the phase-0 baseline, which is the old pipeline's
      // page — not the new path with enrichment switched off. Both are scored.
      let oldPage: string[] = [];
      try {
        const legacy = await pipeline.search({ q, pageSize });
        oldPage = legacy.hits.flatMap(h => (h.bestPdfUrl ? [h.bestPdfUrl] : []));
      } catch (error) {
        console.log(`  old path failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const urls = [...new Set([
        ...oldPage,
        ...before.papers.flatMap(p => (p.fullText ? [p.fullText.url] : [])),
        ...after.papers.flatMap(p => (p.fullText ? [p.fullText.url] : []))
      ])];
      const verdicts = new Map<string, boolean>();
      await Promise.all(urls.map(async url => { verdicts.set(url, await perHost(url, () => servesPdf(url))); }));

      const score = (papers: readonly Paper[]) =>
        papers.filter(p => p.fullText && verdicts.get(p.fullText.url)).length;
      const held = (papers: readonly Paper[]) => papers.filter(p => p.fullText).length;

      bareTested += held(before.papers);
      bareDownloads += score(before.papers);
      richTested += held(after.papers);
      richDownloads += score(after.papers);
      const oldOk = oldPage.filter(u => verdicts.get(u)).length;
      oldTested += oldPage.length;
      oldDownloads += oldOk;
      console.log(`  downloadable  old path ${oldOk}/${oldPage.length}   new, unenriched ${score(before.papers)}/${held(before.papers)}   new, enriched ${score(after.papers)}/${held(after.papers)}   (${urls.length} distinct URLs)`);
    }
  }

  console.log(`\n\nFIELD COVERAGE over ${enriched} papers (${queries.length} queries, pageSize ${pageSize})`);
  console.log('field            before   after');
  for (const field of FIELDS) {
    const b = bareCoverage[field] ?? 0;
    const a = richCoverage[field] ?? 0;
    const mark = a > b ? '  <-' : '';
    console.log(`  ${field.padEnd(14)} ${String(b).padStart(4)}/${bare}  ${String(a).padStart(4)}/${enriched}${mark}`);
  }

  console.log('\nPROVENANCE — field <- the authority that supplied it');
  for (const [key, n] of [...provenance.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(34)} ${n}`);
  }

  if (download) {
    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');
    console.log('\nDOWNLOAD SUCCESS — advertised copies that served a PDF');
    console.log(`  old pipeline        ${oldDownloads}/${oldTested}  ${pct(oldDownloads, oldTested)}`);
    console.log(`  new, unenriched     ${bareDownloads}/${bareTested}  ${pct(bareDownloads, bareTested)}`);
    console.log(`  new, enriched       ${richDownloads}/${richTested}  ${pct(richDownloads, richTested)}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
