import type { Paper, SearchParams, SearchResponse } from '@sci-open/shared';
import { parseQuery, type CitationLink, type DoiResolution, type Engine, type EngineLogger, type FullTextDocument } from '@sci-open/core';
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
  /** Full texts by paper id; a function to answer, or throw, per read. */
  documents?: Record<string, FullTextDocument> | ((paperId: string, trustedOnly: boolean) => Promise<FullTextDocument | null>);
  /** Citation links by `references|<doi>` or `cited_by|<doi>`; a function to answer, or throw. */
  citations?: Record<string, CitationLink[]> | ((doi: string, direction: 'references' | 'cited_by') => Promise<CitationLink[]>);
  /** The records for `resolveDois`, Crossref's batch. Defaults to every paper
   * with a DOI; a function to answer, or to leave DOIs unasked. */
  batch?: (dois: readonly string[]) => Promise<DoiResolution>;
};

/** A logger that drops everything, for deps whose log no test reads. */
export const quietLogger: EngineLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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
    // An author: a word of some author's name, as a source matches one.
    const author = q.match(/^(.*) AND AU="?([^"]+)"?$/);
    if (author) return p.authors.some(a => tokens(a).includes(author[2]!.toLowerCase())) && matches(author[1]!, p);
    // Title words, or for TS= the title and abstract: every word present, in any order.
    const words = q.match(/^(TI|TS)=\((.*)\)$/);
    if (words) {
      const have = new Set(tokens(words[1] === 'TI' ? p.title : `${p.title} ${p.abstract ?? ''}`));
      return words[2]!.split(' ').every(w => have.has(w));
    }
    return tokens(p.title).some(t => tokens(q).includes(t));
  };

  const engine: Engine = {
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
    },
    async readFullText(paper, { trustedOnly }) {
      const { documents } = options;
      if (typeof documents === 'function') return documents(paper.id, trustedOnly);
      return documents?.[paper.id] ?? null;
    },
    async citationLinks(doi, direction) {
      const { citations } = options;
      if (typeof citations === 'function') return citations(doi, direction);
      return citations?.[`${direction}|${doi.toLowerCase()}`] ?? [];
    },
    async resolveDois(dois) {
      if (options.batch) return options.batch(dois);
      const found = new Map<string, Paper>();
      for (const doi of dois) {
        const paper = papers.find(p => p.doi?.toLowerCase() === doi.toLowerCase());
        if (paper) found.set(doi.toLowerCase(), paper);
      }
      return { found, unasked: [] };
    }
  };

  const deps: ToolDeps = {
    engine,
    config: defaultMcpConfig('test'),
    metrics: nullMetrics,
    logger: quietLogger,
    signal: new AbortController().signal,
    admit,
    transport: 'stdio',
    progress: () => {}
  };
  return { engine, deps, searches, admitted: () => admitted };
}

function response(papers: Paper[], total: number, page: number, pageSize: number): SearchResponse {
  return {
    papers, total, page, pageSize, facets: {}, complete: true, bounded: false, countsFromSources: false,
    providers: [{ provider: 'crossref', status: 'ok', retrieved: total, totalHits: total, latency: 1 }]
  };
}
