import { describe, it, expect } from 'vitest';
import path from 'path';
import { fixtureEngine, loadFixtures } from '../src/fixture-engine';
import { getCitations } from '../src/tools/get-citations';
import { exportCitations } from '../src/tools/export-citations';
import { fakeEngine } from './fake-engine';

/**
 * The recordings `--engine fixture` serves (fixtures/engine.json), which the
 * evals and demos run on: the citation lists they ask for, and the records
 * that make those lists and the export cases readable, all offline.
 */

const engine = fixtureEngine(loadFixtures(path.join(__dirname, '..', 'fixtures', 'engine.json')), { strict: false });
const deps = { ...fakeEngine([]).deps, engine };

describe('the recorded fixtures', () => {
  it('serve a paper’s references with records for the first page', async () => {
    const { structured } = await getCitations.run(getCitations.input.parse({ paper: '10.7717/peerj-cs.421', direction: 'references' }), deps);
    expect(structured).toMatchObject({ total_links: 37, returned: 20, next_offset: 20 });
    expect(structured.links.filter(l => l.record).length).toBeGreaterThanOrEqual(15);
  });

  it('serve the citers the evals ask about', async () => {
    const { structured } = await getCitations.run(getCitations.input.parse({ paper: 'https://doi.org/10.1371/journal.pone.0000217', direction: 'cited_by' }), deps);
    expect(structured.total_links).toBe(66);
    expect(structured.links[0]!.created).toBeDefined();
  });

  it('resolve every paper the export cases name', async () => {
    const papers = ['10.1038/nature14539', '10.1126/science.aaa8415', '10.7717/peerj-cs.421', '10.1371/journal.pone.0000217'];
    const { structured } = await exportCitations.run(exportCitations.input.parse({ papers }), deps);
    expect(structured).toMatchObject({ entries: 4, unresolved: [] });
  });
});
