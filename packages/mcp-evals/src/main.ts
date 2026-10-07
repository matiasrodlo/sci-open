import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { runClaudeCode } from './claude-code';
import { addUpstream, connect, runCase, type RunResult, type Upstream } from './run';
import { serverNamed, type Detail } from './servers';
import {
  parseVerdicts, scoreReading, scoreReferences, scoreSelection, VERDICT_MEANINGS,
  type ReadingCase, type ReferenceItem, type SelectionCase
} from './scorers';
import { writeReport, type CaseRecord, type Grade } from './report';

/**
 * One suite: `tsx src/main.ts <selection|references|reading> [tune|holdout]
 * [--server <name>] [--via-model] [--client claude-code] [--without <sources>]`,
 * default `tune` against sci-open. Tune on
 * `tune`; `holdout` is the set not read while changing descriptions, and the
 * number the README publishes.
 *
 * - selection: does a model choose the right tool, with the right arguments?
 *   Against the fixture engine, so the server answers the same every run and
 *   only the model varies. Calls the Claude API. sci-open only: it scores
 *   sci-open's tool names.
 * - references: are planted errors graded right? A server with a checker of
 *   its own (verify_references, OpenAlex's resolve_references) is called
 *   directly: live sources, no model, no API cost. One without — or any, with
 *   `--via-model` — has Claude check each list with its tools and answer one
 *   verdict a reference, which costs API credit.
 * - reading: can a model answer a question that only a paper's full text
 *   answers, through the server's tools? Live sources and the Claude API.
 *
 * `--server` picks a baseline instead of sci-open (src/servers.ts); its report
 * carries the server's name, and is scored by the same scorers.
 *
 * `--client claude-code` has Claude Code ask the model (src/claude-code.ts), on
 * the signed-in Claude account, where the default calls the Claude API. Its
 * report carries `claude-code`: Claude Code's system prompt makes it another
 * measurement, not the same one paid for differently.
 *
 * `--without openalex` serves sci-open with those sources left out
 * (SCI_OPEN_WITHOUT), and its report says so: what they are worth, measured.
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
  fallbackTurns: run.usage.fallbackTurns,
  ...(run.upstream ? { upstreamRequests: run.upstream.requests, openalexCostUsd: run.upstream.openalexCostUsd } : {})
});

/** A run a fallback model answered, or that was refused, measures no server. */
const scorable = (run: RunResult) => run.usage.fallbackTurns === 0 && run.stopReason !== 'refusal';

function referenceLists(split: string): Array<{ file: string; items: ReferenceItem[] }> {
  return readdirSync(path.join(DATA, 'references'))
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(file => ({ file, ...(JSON.parse(readFileSync(path.join(DATA, 'references', file), 'utf8')) as { split: string; items: ReferenceItem[] }) }))
    .filter(list => list.split === split);
}

/** A reference list for a model to check, graded in verify_references' words. */
function referencePrompt(references: readonly string[]): string {
  return [
    'Check whether each of these references names a real paper and cites it correctly, using the tools. Do not answer from memory.',
    '',
    ...references.map((r, i) => `${i + 1}. ${r}`),
    '',
    'Grade each one with exactly one of these words:',
    ...Object.entries(VERDICT_MEANINGS).map(([verdict, meaning]) => `- ${verdict}: ${meaning}`),
    '',
    'End with one line per reference, in order, and nothing after them:',
    ...references.slice(0, 2).map((_, i) => `Verdict ${i + 1}: <grade>`),
    ...(references.length > 2 ? ['…'] : [])
  ].join('\n');
}

/**
 * pnpm forwards a `--` written before the script's own arguments, wherever it
 * stands. It is not one: read as the end of the options, it would turn
 * `--server openalex` into two stray words and run the live suite against
 * sci-open instead. A word left over is refused for the same reason.
 */
function readArgs() {
  const parsed = parseArgs({
    args: process.argv.slice(2).filter(arg => arg !== '--'),
    allowPositionals: true,
    strict: true,
    options: {
      server: { type: 'string', default: 'sci-open' },
      'via-model': { type: 'boolean', default: false },
      client: { type: 'string', default: 'api' },
      without: { type: 'string' }
    }
  });
  if (parsed.positionals.length > 2) {
    throw new Error(`Unexpected argument "${parsed.positionals[2]}": <suite> [tune|holdout] [--server <name>] [--via-model] [--client claude-code] [--without <sources>]`);
  }
  if (parsed.values.client !== 'api' && parsed.values.client !== 'claude-code') throw new Error(`Unknown client "${parsed.values.client}": api or claude-code`);
  return parsed;
}

async function main(): Promise<void> {
  const { values, positionals } = readArgs();
  const [suite, split = 'tune'] = positionals;
  if (split !== 'tune' && split !== 'holdout') throw new Error(`Unknown split "${split}": tune or holdout`);
  const baseline = values.server === 'sci-open' ? undefined : values.server;
  const viaClaudeCode = values.client === 'claude-code';
  const ask = viaClaudeCode ? runClaudeCode : runCase;
  const clientLabel = viaClaudeCode ? 'claude-code' : undefined;
  // Sources sci-open leaves out, for the server and for the report's name.
  const without = values.without?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) ?? [];
  if (without.length && baseline) throw new Error('--without leaves sources out of sci-open; it does not apply to a baseline.');
  const withoutEnv: Record<string, string> = without.length ? { SCI_OPEN_WITHOUT: without.join(',') } : {};
  const withoutLabel = without.length ? `without-${without.join('-')}` : undefined;

  if (suite === 'selection') {
    if (baseline) throw new Error('The selection suite scores sci-open\'s own tool names. Run references or reading against a baseline.');
    if (without.length) throw new Error('The selection suite runs on recorded answers, which --without does not change.');
    const records: CaseRecord[] = [];
    for (const c of jsonl<SelectionCase>('tool-selection.jsonl').filter(c => c.split === split)) {
      const started = Date.now();
      // Four turns are plenty to see the first calls; the fixture engine answers them.
      const server = serverNamed('sci-open', ['--engine', 'fixture', ...(c.toolsets ? ['--toolsets', c.toolsets] : [])]);
      const run = await ask(c.prompt, server, 4);
      records.push(record(c.id, scoreSelection(c, run.calls), run, Date.now() - started));
      console.log(`${c.id} ${records.at(-1)!.pass ? 'pass' : `FAIL ${records.at(-1)!.why}`}`);
    }
    console.log(writeReport('selection', split, records, viaClaudeCode ? { client: 'claude-code' } : {}, clientLabel));
    return;
  }

  if (suite === 'references') {
    // A list of 25 can take three lookups a reference; the default budget of
    // 30 new searches a minute would leave most of it not_checked.
    const server = serverNamed(values.server, ['--toolsets', 'core'], {
      SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN: process.env.SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN ?? '200',
      ...withoutEnv
    });
    const viaModel = values['via-model'] || !server.verify;
    const items: ReferenceItem[] = [];
    const verdicts: string[] = [];
    const lists: string[] = []; // each reference's list file
    const details: Detail[] = [];
    const runs: RunResult[] = [];
    let upstream: Upstream | undefined;

    if (viaModel) {
      for (const list of referenceLists(split)) {
        const started = Date.now();
        // Thirty turns: a lookup or two a reference, several at a time, and the answer.
        const run = await ask(referencePrompt(list.items.map(i => i.text)), server, 30);
        runs.push(run);
        upstream = addUpstream(upstream, run.upstream);
        items.push(...list.items);
        lists.push(...list.items.map(() => list.file));
        verdicts.push(...(scorable(run) ? parseVerdicts(run.answer, list.items.length) : list.items.map(() => 'not_checked')));
        console.log(`${list.file}: ${Date.now() - started} ms, ${run.calls.length} tool calls`);
      }
    } else {
      const client = await connect(server);
      try {
        for (const list of referenceLists(split)) {
          const started = Date.now();
          items.push(...list.items);
          lists.push(...list.items.map(() => list.file));
          const checked = await server.verify!(client, list.items.map(i => i.text));
          verdicts.push(...checked.verdicts);
          details.push(...(checked.details ?? []));
          upstream = addUpstream(upstream, checked.upstream);
          console.log(`${list.file}: ${Date.now() - started} ms`);
        }
      } finally {
        await client.close();
      }
    }

    const score = scoreReferences(items, verdicts);
    // Every reference's grade, so a miss or an unchecked one can be looked
    // into without running the list again.
    const grades: Grade[] = items.map((item, i) => ({
      list: lists[i]!, text: item.text, planted: item.planted, accept: item.accept,
      verdict: verdicts[i] ?? 'not_checked', ...details[i]
    }));
    const perList = (f: (run: RunResult) => number) => runs.reduce((n, run) => n + f(run), 0) / runs.length;
    const cost = runs.length
      ? {
          meanToolCallsPerList: perList(run => run.calls.length),
          meanInputTokensPerList: perList(run => run.usage.input),
          meanOutputTokensPerList: perList(run => run.usage.output),
          listsNotScored: runs.filter(run => !scorable(run)).length
        }
      : {};
    const label = [baseline, viaModel ? 'model' : undefined, viaModel ? clientLabel : undefined, withoutLabel].filter(Boolean).join('-');
    const asked = `${runs[0]?.models.join(', ') ?? 'none'}${viaClaudeCode ? ', through Claude Code' : ''}`;
    console.log(writeReport('references', split, [], {
      server: server.name, mode: viaModel ? `model (${asked})` : 'direct',
      ...(without.length ? { without: without.join(', ') } : {}),
      references: items.length, ...cost,
      // What the run asked of the sources, when the server says: the number
      // the OpenAlex budget is spent against.
      ...(upstream
        ? { upstreamRequests: upstream.requests, upstreamRequestsPerReference: upstream.requests / items.length, openalexCostUsd: upstream.openalexCostUsd }
        : {}),
      ...score,
      grades
    }, label));
    if (score.notChecked > 0) {
      console.error(`${score.notChecked} references were not checked: a search budget ran out, a call failed, or a fallback model answered. Re-run rather than publish this.`);
      process.exitCode = 1;
    }
    return;
  }

  if (suite === 'reading') {
    const server = serverNamed(values.server, ['--toolsets', 'core,read'], withoutEnv);
    const records: CaseRecord[] = [];
    for (const c of jsonl<ReadingCase>('reading.jsonl').filter(c => c.split === split)) {
      const started = Date.now();
      const prompt = `${c.question} The paper: ${c.paper}. Read it with the tools; do not answer from memory. End with one line: Answer: <value>`;
      // Eight turns: an outline, a section or two, perhaps a search, and the answer.
      const run = await ask(prompt, server, 8);
      records.push(record(c.id, scoreReading(c.answers, run.answer), run, Date.now() - started));
      console.log(`${c.id} ${records.at(-1)!.pass ? 'pass' : `FAIL ${records.at(-1)!.why}`}`);
    }
    const label = [baseline, clientLabel, withoutLabel].filter(Boolean).join('-');
    console.log(writeReport('reading', split, records, {
      ...(baseline ? { server: baseline } : {}), ...(viaClaudeCode ? { client: 'claude-code' } : {}),
      ...(without.length ? { without: without.join(', ') } : {})
    }, label));
    return;
  }

  throw new Error(`Unknown suite "${suite}": selection, references or reading`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
