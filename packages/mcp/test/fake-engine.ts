import type { Paper, SearchParams, SearchResponseV2 } from '@open-access-explorer/shared';
import { parseQuery, UpstreamStats, type Engine } from '@open-access-explorer/core';
import { defaultMcpConfig } from '../src/config';
import { nullMetrics } from '../src/metrics';
import type { ToolDeps } from '../src/framework/define-tool';
import { AdmissionError } from '../src/errors';
import { tokens } from '../src/references/match';

/**
 * An engine over a list of papers, for tool tests that need searches to
 * answer by content rather than by recorded key. Every query goes through the
 * real grammar first, so a query the live engine would refuse fails here too.
 */
export type FakeOptions = {
  /** DOIs the DOI system holds; `null` makes the registry fail to answer. */
  registered?: readonly string[] | null;
  /** Admissions granted before each further one is refused. */
  admissions?: number;
};

export type Fake = { engine: Engine; deps: ToolDeps; searches: string[]; admitted: () => number };

export function fakeEngine(papers: readonly Paper[], options: FakeOptions = {}): Fake {
  const searches: string[] = [];
  let admitted = 0;
  const admit = async () => {
    if (options.admissions !== undefined && admitted >= options.admissions) throw new AdmissionError(42);
    admitted++;
  };

  const matches = (q: string, p: Paper): boolean => {
    const years = q.match(/^(.*) AND PY=(\d{4})-(\d{4})$/);
    if (years) return p.year !== undefined && p.year >= Number(years[2]) && p.year <= Number(years[3]) && matches(years[1]!, p);
    // Title words, or for TS= the title and abstract: every word present, in any order.
    const words = q.match(/^(TI|TS)=\((.*)\)$/);
    if (words) {
      const have = new Set(tokens(words[1] === 'TI' ? p.title : `${p.title} ${p.abstract ?? ''}`));
      return words[2]!.split(' ').every(w => have.has(w));
    }
    return tokens(p.title).some(t => tokens(q).includes(t));
  };

  const engine: Engine = {
    userAgent: 'fake',
    stats: new UpstreamStats(),
    async search(params: SearchParams, extra = {}) {
      const query = params.doi ?? params.q ?? '';
      parseQuery(query); // throws as the live engine would
      await extra.admit?.();
      searches.push(query);
      const found = params.doi
        ? papers.filter(p => p.doi?.toLowerCase() === params.doi!.toLowerCase())
        : papers.filter(p => matches(query, p));
      const pageSize = params.pageSize ?? 10;
      const page = params.page ?? 1;
      return { response: response(found.slice((page - 1) * pageSize, page * pageSize), found.length, page, pageSize), fromCache: false };
    },
    async count() {
      return { reports: [], complete: true };
    },
    // As the live engine asks a provider by its own id: any source's id names
    // the paper, and an arXiv id without a version names every version.
    async lookup(id) {
      const [provider, native] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      return papers.find(p => p.id === id || p.sources.some(s =>
        s.provider === provider && (s.nativeId === native || s.nativeId.replace(/v\d+$/, '') === native))) ?? null;
    },
    async lookupDoi(doi, extra = {}) {
      await extra.admit?.();
      return papers.find(p => p.doi?.toLowerCase() === doi.toLowerCase()) ?? null;
    },
    async doiRegistered(doi) {
      if (options.registered === null) return undefined;
      return papers.some(p => p.doi?.toLowerCase() === doi.toLowerCase()) ||
        (options.registered ?? []).some(d => d.toLowerCase() === doi.toLowerCase());
    }
  };

  const deps: ToolDeps = {
    engine,
    config: defaultMcpConfig('test'),
    metrics: nullMetrics,
    admit,
    transport: 'stdio',
    progress: () => {}
  };
  return { engine, deps, searches, admitted: () => admitted };
}

function response(papers: Paper[], total: number, page: number, pageSize: number): SearchResponseV2 {
  return {
    papers, total, page, pageSize, sort: 'relevance', facets: {}, complete: true, bounded: false, countsFromSources: false,
    providers: [{ provider: 'openalex', status: 'ok', retrieved: total, totalHits: total, latency: 1 }],
    authorities: [], duration: 1
  };
}
