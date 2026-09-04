/**
 * Where in a provider's own result list its record for a given id actually
 * lands.
 *
 * `orchestrator/lookup.ts` asks a search endpoint for one record whenever the
 * provider has no by-id route — six of the ten — and reads only the first
 * `DEFAULT_DEPTH` results, on a stated assumption: "A native id either matches
 * near the top or is not in the index." That sentence is the whole argument for
 * the number being 10, and nothing has ever tested it. When it is wrong the
 * endpoint answers 404 for a paper that exists, which is indistinguishable from
 * the paper genuinely not being there.
 *
 * The unit suite pins the *request* (`lookup.test.ts` asserts depth <= 10) and
 * cannot pin this: the answer lives in the providers' ranking, not in our code.
 * So it is measured, the way the capabilities table was, and it is a script
 * rather than a test because it needs the live APIs and the offline suite is
 * offline by construction.
 *
 *   pnpm --filter @open-access-explorer/api exec tsx scripts/lookup-depth.ts
 *   ... --records=15        ids to sample per provider
 *   ... --depth=100         how deep to look before calling it a miss
 *   ... --timeout=20000     per-request budget
 *
 * Method. Ids are drawn from live keyword searches rather than chosen, so the
 * sample is the kind of record a reader actually clicks through to. Each id is
 * then asked for the way `lookupPaper` asks — `parseQuery(nativeId)` against
 * the same `search`, with `openAccessOnly` off — but read to `--depth` instead
 * of 10, and the position of the matching record is reported.
 *
 * What to do with the output. The rank column is the answer: if every provider's
 * worst case sits comfortably under 10, the assumption holds and the number is
 * right. A provider whose records land past it is 404ing real papers today, and
 * the fix is either a per-provider depth or a real by-id route for it. A `miss`
 * at --depth=100 means the id is not findable through search at all, which is a
 * different bug and a worse one.
 *
 * Nothing here writes to the tree. It reports, and the judgement stays human.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import type { Paper } from '@open-access-explorer/shared';
import { parseQuery, PROVIDERS } from '../src/orchestrator';
import type { ProviderEntry } from '../src/orchestrator/registry';

const QUERIES = [
  'crispr gene editing',
  'alzheimer amyloid beta',
  'antibiotic resistance mechanisms',
  'gut microbiome obesity',
  'sars-cov-2 spike protein'
];

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const RECORDS = arg('records', 15);
const DEPTH = arg('depth', 100);
const TIMEOUT_MS = arg('timeout', 20000);

const USER_AGENT = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'your-email@example.com'})`;

/**
 * The providers this actually concerns: no by-id route, so `lookup` searches.
 *
 * Whether ids can be *sampled* from one is decided by trying, not by reading
 * `capabilities.keywordSearch`. That flag was the obvious predicate and it is
 * the wrong one: it answers "should the orchestrator spend a fan-out request
 * here", which is not the same question. DataCite declares it false because its
 * records are datasets, disjoint from the literature providers by construction,
 * so keyword hits would merge with nothing — but the API keyword-searches
 * perfectly well, and filtering on the flag silently dropped a provider this
 * script had already measured at rank 0 across fifteen ids.
 *
 * bioRxiv is the genuinely different case: no keyword index exists at all, only
 * date windows and a per-DOI lookup. It falls out of the same empirical test by
 * returning nothing, and is reported as uncovered rather than as a pass — which
 * is the distinction that matters and the one the flag was standing in for.
 *
 * bioRxiv is also the provider least exposed to the question. Its native ids
 * are DOIs and `doiLookup` is true, so `parseQuery` sends a lookup to
 * `/details/{server}/{doi}` — an exact endpoint, not a ranked list a depth can
 * cut off.
 */
const SEARCHES_FOR_IDS = PROVIDERS.filter(p => !p.lookup);

/** The same comparison `lookupPaper` makes, so a hit here is a hit there. */
function matches(paper: Paper, provider: string, nativeId: string): boolean {
  const ref = paper.sources[0];
  if (!ref || ref.provider !== provider) return false;
  return ref.nativeId === nativeId || ref.nativeId.toLowerCase() === nativeId.toLowerCase();
}

/** Native ids this provider really returns, drawn from ordinary searches. */
async function sampleIds(entry: ProviderEntry): Promise<string[]> {
  const ids: string[] = [];

  for (const q of QUERIES) {
    if (ids.length >= RECORDS) break;
    try {
      const { papers } = await entry.search({
        query: parseQuery(q),
        depth: Math.ceil(RECORDS / 2),
        offset: 0,
        timeoutMs: TIMEOUT_MS,
        openAccessOnly: false,
        userAgent: USER_AGENT
      });
      for (const paper of papers) {
        const nativeId = paper.sources[0]?.nativeId;
        if (nativeId && !ids.includes(nativeId)) ids.push(nativeId);
      }
    } catch (error) {
      console.error(`  ! ${entry.id} search failed for "${q}": ${(error as Error).message}`);
    }
  }

  return ids.slice(0, RECORDS);
}

/** Zero-based rank of the record among what its own id returns, or null. */
async function rankOfSelf(entry: ProviderEntry, nativeId: string): Promise<number | null> {
  const { papers } = await entry.search({
    query: parseQuery(nativeId),
    depth: DEPTH,
    offset: 0,
    timeoutMs: TIMEOUT_MS,
    // Exactly as `lookupPaper` asks: whether a record is open is a fact about
    // it, not a condition on finding it.
    openAccessOnly: false,
    userAgent: USER_AGENT
  });

  const at = papers.findIndex(p => matches(p, entry.id, nativeId));
  return at === -1 ? null : at;
}

async function main() {
  console.log(
    `Sampling up to ${RECORDS} ids from each of ${SEARCHES_FOR_IDS.length} providers ` +
      `that answer a by-id lookup by searching, reading ${DEPTH} deep.\n` +
      'lookup.ts reads 10. Any rank at or past that is a paper the /api/paper/:id ' +
      'endpoint 404s today.\n'
  );

  const rows: Array<{
    provider: string; n: number; worst: number | null; over: number; missed: number; errors: number;
  }> = [];

  for (const entry of SEARCHES_FOR_IDS) {
    console.log(`${entry.id}:`);
    const ids = await sampleIds(entry);

    if (ids.length === 0) {
      console.log('  no ids sampled — provider returned nothing for any query\n');
      rows.push({ provider: entry.id, n: 0, worst: null, over: 0, missed: 0, errors: 0 });
      continue;
    }

    let worst: number | null = null;
    let over = 0;
    let missed = 0;
    let errors = 0;

    for (const nativeId of ids) {
      try {
        const rank = await rankOfSelf(entry, nativeId);
        if (rank === null) {
          missed += 1;
          console.log(`  miss   ${nativeId}`);
          continue;
        }
        if (rank >= 10) {
          over += 1;
          console.log(`  rank ${String(rank).padStart(3)} ${nativeId}   <-- past the depth lookup.ts reads`);
        }
        worst = worst === null ? rank : Math.max(worst, rank);
      } catch (error) {
        errors += 1;
        console.error(`  error  ${nativeId}: ${(error as Error).message}`);
      }
    }

    // `answered` is the only number the verdict may rest on. A probe that threw
    // asked nothing, and counting the ids we *meant* to probe is how a run that
    // mostly failed reports a clean result.
    const answered = ids.length - errors;
    console.log(
      `  ${answered}/${ids.length} probed · worst rank ${worst ?? 'n/a'} · ` +
        `${over} past depth 10 · ${missed} not found · ${errors} errored\n`
    );
    rows.push({ provider: entry.id, n: ids.length, worst, over, missed, errors });
  }

  console.log('provider     probed  worst rank  past 10  not found  errored');
  for (const r of rows) {
    if (r.n === 0) {
      console.log(
        `${r.provider.padEnd(12)} ${'-'.padStart(6)} ${'-'.padStart(11)} ${'-'.padStart(8)} ${'-'.padStart(10)} ` +
          `${'-'.padStart(8)}   no ids to draw: provider has no keyword index`
      );
      continue;
    }
    console.log(
      `${r.provider.padEnd(12)} ${String(r.n - r.errors).padStart(6)} ${String(r.worst ?? '-').padStart(11)} ` +
        `${String(r.over).padStart(8)} ${String(r.missed).padStart(10)} ${String(r.errors).padStart(8)}`
    );
  }

  const broken = rows.filter(r => r.over > 0 || r.missed > 0);
  if (broken.length > 0) {
    console.log(`\n${broken.map(r => r.provider).join(', ')} returned records lookup.ts would not have found.`);
    return;
  }

  /**
   * A pass has to be a pass *over something*. A provider whose probes all threw
   * and one that was never probed are both absences of evidence, and reporting
   * either as "the assumption holds" is how a measurement becomes a rubber
   * stamp.
   */
  const gaps = rows.filter(r => r.n - r.errors === 0).map(r => r.provider);
  const partial = rows.filter(r => r.errors > 0 && r.n - r.errors > 0).map(r => r.provider);

  console.log('\nEvery record actually probed was inside depth 10.');
  if (partial.length > 0) {
    console.log(`Partial coverage: ${partial.join(', ')} lost probes to errors — rerun before trusting those rows.`);
  }
  console.log(
    gaps.length === 0
      ? 'Coverage is complete: the assumption holds for this sample.'
      : `Not covered at all: ${gaps.join(', ')}. The assumption is unmeasured for them.`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
