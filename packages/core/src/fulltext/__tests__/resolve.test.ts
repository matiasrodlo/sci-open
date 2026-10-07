import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { Paper } from '@sci-open/shared';

/**
 * Which tier answers, and what the reader is told when none can. Every
 * upstream is a stub keyed by host, the arXiv pacer runs on a clock the test
 * holds, and the PDF reader is replaced, so nothing leaves the process.
 */

const { hosts, pacing, pdf } = vi.hoisted(() => ({
  hosts: new Map<string, (path: string, config: any) => Promise<{ status: number; data: unknown }>>(),
  pacing: { wait: 0 },
  pdf: { pages: vi.fn() }
}));

vi.mock('../../lib/http-client-factory', () => ({
  getPooledClient: (baseUrl: string) => ({
    get: (path: string, config: unknown) => {
      const handler = hosts.get(baseUrl);
      if (!handler) throw new Error(`unexpected request to ${baseUrl}${path}`);
      return handler(path, config);
    }
  })
}));

vi.mock('../../lib/host-pacer', async original => {
  const actual = await original<typeof import('../../lib/host-pacer')>();
  // A pacer whose next slot is `pacing.wait` away, whatever has gone before.
  const pacer = {
    host: 'arxiv.org',
    acquire: async (maxWaitMs: number) => {
      if (pacing.wait > maxWaitMs) throw new actual.SourceBusyError('arxiv.org', pacing.wait);
    }
  };
  return { ...actual, ARXIV_PACER: pacer, pacerFor: (url: string) => (url.includes('arxiv.org') ? pacer : undefined) };
});

vi.mock('../pdf', () => ({ pdfToSections: pdf.pages }));

import { resolveFullText } from '../resolve';
import { SourceBusyError } from '../../lib/host-pacer';
import { paper, ref } from '../../orchestrator/__tests__/helpers';

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const JATS = readFileSync(path.join(FIXTURES, 'PMC1790863.xml'), 'utf8');
const ARXIV = readFileSync(path.join(FIXTURES, 'arxiv-2404.18021.html'), 'utf8');
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

const OPTIONS = { userAgent: 'test', trustedOnly: false, now: () => new Date('2026-10-02T00:00:00Z') };

/** Europe PMC holding the paper, open or not. */
function europePmc(hit: Record<string, string> | undefined) {
  hosts.set(EPMC, async (p: string) =>
    p === '/search'
      ? { status: 200, data: { resultList: { result: hit ? [hit] : [] } } }
      : { status: 200, data: JATS });
}

const plos: Paper = paper({ id: 'plos:10.1371/journal.pone.0000217', doi: '10.1371/journal.pone.0000217', fullText: { url: 'https://journals.plos.org/x.pdf', kind: 'pdf', verified: true } });
const preprint: Paper = paper({ id: 'arxiv:2404.18021v1', doi: undefined, sources: [ref('arxiv', { nativeId: '2404.18021v1' })], fullText: { url: 'https://arxiv.org/pdf/2404.18021v1', kind: 'pdf', verified: true } });

beforeEach(() => {
  hosts.clear();
  pacing.wait = 0;
  pdf.pages.mockReset();
});

describe('resolveFullText', () => {
  it('reads Europe PMC’s JATS when it holds an open copy', async () => {
    europePmc({ pmcid: 'PMC1790863', isOpenAccess: 'Y', inEPMC: 'Y' });

    const { doc, definitive } = await resolveFullText(plos, OPTIONS);

    expect(doc).toMatchObject({
      paperId: 'plos:10.1371/journal.pone.0000217', tier: 'europepmc-jats', url: `${EPMC}/PMC1790863/fullTextXML`,
      title: 'Quantifying Organismal Complexity using a Population Genetic Approach', retrievedAt: '2026-10-02T00:00:00.000Z'
    });
    expect(doc!.totalChars).toBe(doc!.sections.reduce((n, s) => n + s.text.length, 0));
    expect(definitive).toBe(true);
    expect(pdf.pages).not.toHaveBeenCalled();
  });

  it('asks Europe PMC by PMID when the record has no DOI', async () => {
    let asked = '';
    hosts.set(EPMC, async (p: string, config: any) => {
      if (p === '/search') asked = config.params.query;
      return { status: 200, data: { resultList: { result: [] } } };
    });
    await resolveFullText(paper({ doi: undefined, sources: [ref('ncbi', { nativeId: '17299599' })], fullText: undefined }), OPTIONS);
    expect(asked).toBe('EXT_ID:17299599 AND SRC:MED');
  });

  it('reads arXiv’s HTML rendering when Europe PMC has no open copy', async () => {
    europePmc({ pmcid: 'PMC1', isOpenAccess: 'N', inEPMC: 'Y' });
    hosts.set('https://arxiv.org', async (p: string) => (p === '/html/2404.18021v1' ? { status: 200, data: ARXIV } : { status: 404, data: '' }));

    const { doc } = await resolveFullText({ ...preprint, doi: '10.48550/arXiv.2404.18021' }, OPTIONS);

    expect(doc).toMatchObject({ tier: 'arxiv-html', url: 'https://arxiv.org/html/2404.18021v1' });
  });

  it('finds the arXiv id in arXiv’s own DOI', async () => {
    let fetched = '';
    europePmc(undefined);
    hosts.set('https://arxiv.org', async (p: string) => { fetched = p; return { status: 404, data: '' }; });
    await resolveFullText(paper({ doi: '10.48550/arXiv.2404.18021', sources: [ref('datacite')], fullText: undefined }), OPTIONS);
    expect(fetched).toBe('/html/2404.18021');
  });

  it('stops at the tier its signal aborts, rejecting with the reason and trying no other', async () => {
    const signals: AbortSignal[] = [];
    hosts.set(EPMC, (_path: string, config: { signal: AbortSignal }) => {
      signals.push(config.signal);
      return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true }));
    });
    const reader = new AbortController();

    const reading = resolveFullText(plos, { ...OPTIONS, signal: reader.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    reader.abort();

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdf.pages).not.toHaveBeenCalled();
  });

  it('says it was stopped, not that there is no copy, when a tier finds none after the signal aborts', async () => {
    europePmc(undefined);
    const reader = new AbortController();
    pdf.pages.mockImplementation(async () => {
      reader.abort();
      return [];
    });

    await expect(resolveFullText(plos, { ...OPTIONS, signal: reader.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdf.pages).toHaveBeenCalledWith('https://journals.plos.org/x.pdf', 'test', reader.signal);
  });

  it('falls back to the PDF, a page a section, when neither has the paper', async () => {
    europePmc(undefined);
    pdf.pages.mockResolvedValue([{ id: 'p1', title: 'Page 1', text: 'Hello' }, { id: 'p2', title: 'Page 2', text: 'World' }]);

    const { doc } = await resolveFullText(plos, OPTIONS);

    expect(doc).toMatchObject({ tier: 'pdf', url: 'https://journals.plos.org/x.pdf', totalChars: 10 });
    expect(pdf.pages).toHaveBeenCalledWith('https://journals.plos.org/x.pdf', 'test', undefined);
  });

  it('never fetches from a publisher in trusted mode', async () => {
    europePmc(undefined);
    const { doc, definitive } = await resolveFullText(plos, { ...OPTIONS, trustedOnly: true });
    expect(doc).toBeNull();
    expect(definitive).toBe(true);
    expect(pdf.pages).not.toHaveBeenCalled();
  });

  it('says "later", not "none", when the only copy is on a paced host with no slot soon enough', async () => {
    europePmc(undefined);
    pacing.wait = 45_000;

    const refused = await resolveFullText(preprint, OPTIONS).catch(error => error);

    expect(refused).toBeInstanceOf(SourceBusyError);
    expect(refused.retryAfterMs).toBe(45_000);
  });

  it('reads another tier rather than waiting on a busy one', async () => {
    europePmc({ pmcid: 'PMC1790863', isOpenAccess: 'Y', inEPMC: 'Y' });
    pacing.wait = 45_000;
    const { doc } = await resolveFullText({ ...preprint, doi: '10.1371/journal.pone.0000217' }, OPTIONS);
    expect(doc?.tier).toBe('europepmc-jats');
  });

  it('calls no copy found after a failure not definitive, so the miss is not held', async () => {
    hosts.set(EPMC, async () => { throw new Error('ETIMEDOUT'); });
    const { doc, definitive } = await resolveFullText(paper({ doi: '10.1234/x', fullText: undefined }), OPTIONS);
    expect(doc).toBeNull();
    expect(definitive).toBe(false);
  });

  it('takes a 200 that is not a LaTeXML page for no rendering', async () => {
    europePmc(undefined);
    hosts.set('https://arxiv.org', async () => ({ status: 200, data: '<html>Captcha</html>' }));
    const { doc } = await resolveFullText({ ...preprint, fullText: undefined }, OPTIONS);
    expect(doc).toBeNull();
  });
});
