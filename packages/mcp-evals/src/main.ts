import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { connect, runCase, type RunResult } from './run';
import { scoreReferences, scoreSelection, type ReferenceItem, type SelectionCase } from './scorers';
import { writeReport, type CaseRecord } from './report';

/**
 * One suite: `tsx src/main.ts <selection|references> [tune|holdout]`, default
 * `tune`. Tune on `tune`; `holdout` is the set not read while changing
 * descriptions, and the number the README publishes.
 *
 * - selection: does a model choose the right tool, with the right arguments?
 *   Against the fixture engine, so the server answers the same every run and
 *   only the model varies. Calls the Claude API.
 * - references: does verify_references grade planted errors right? Live
 *   sources, no model, no API cost.
 */

const DATA = path.join(__dirname, '..', 'datasets');
const jsonl = <T>(file: string): T[] =>
  readFileSync(path.join(DATA, file), 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as T);

const record = (id: string, score: { pass: boolean; why?: string }, run: RunResult, ms: number): CaseRecord => ({
  id, ...score,
  calls: run.calls.length,
  toolErrors: run.calls.filter(c => c.isError).length,
  inputTokens: run.usage.input,
  outputTokens: run.usage.output,
  cacheReadTokens: run.usage.cacheRead,
  ms,
  stopReason: run.stopReason,
  models: run.models,
  fallbackTurns: run.usage.fallbackTurns
});

async function main(): Promise<void> {
  const [suite, split = 'tune'] = process.argv.slice(2);
  if (split !== 'tune' && split !== 'holdout') throw new Error(`Unknown split "${split}": tune or holdout`);

  if (suite === 'selection') {
    const records: CaseRecord[] = [];
    for (const c of jsonl<SelectionCase>('tool-selection.jsonl').filter(c => c.split === split)) {
      const started = Date.now();
      // Four turns are plenty to see the first calls; the fixture engine answers them.
      const run = await runCase(c.prompt, ['--engine', 'fixture'], 4);
      records.push(record(c.id, scoreSelection(c, run.calls), run, Date.now() - started));
      console.log(`${c.id} ${records.at(-1)!.pass ? 'pass' : `FAIL ${records.at(-1)!.why}`}`);
    }
    console.log(writeReport('selection', split, records));
    return;
  }

  if (suite === 'references') {
    // A list of 25 can take three lookups a reference; the default budget of
    // 30 new searches a minute would leave most of it not_checked.
    const client = await connect(['--toolsets', 'core'], {
      SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN: process.env.SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN ?? '200'
    });
    const items: ReferenceItem[] = [];
    const verdicts: string[] = [];
    try {
      for (const file of readdirSync(path.join(DATA, 'references')).filter(f => f.endsWith('.json')).sort()) {
        const list = JSON.parse(readFileSync(path.join(DATA, 'references', file), 'utf8')) as { split: string; items: ReferenceItem[] };
        if (list.split !== split) continue;
        const started = Date.now();
        const result = await client.callTool({ name: 'verify_references', arguments: { references: list.items.map(i => i.text) } }, { timeout: 600_000 });
        const structured = result.structuredContent as { results: Array<{ verdict: string }> } | undefined;
        items.push(...list.items);
        verdicts.push(...list.items.map((_, i) => structured?.results[i]?.verdict ?? 'not_checked'));
        console.log(`${file}: ${Date.now() - started} ms`);
      }
    } finally {
      await client.close();
    }
    const score = scoreReferences(items, verdicts);
    console.log(writeReport('references', split, [], { references: items.length, ...score }));
    if (score.notChecked > 0) {
      console.error(`${score.notChecked} references were not checked: the run hit the search budget. Re-run rather than publish this.`);
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown suite "${suite}": selection or references`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
