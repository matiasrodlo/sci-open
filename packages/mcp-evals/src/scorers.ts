import type { Call } from './run';

export type SelectionCase = {
  id: string;
  split: 'tune' | 'holdout';
  prompt: string;
  expect: { first?: string; sequence?: string[]; args?: Record<string, unknown> };
};

/** An array argument is a set of choices: `["ncbi","europepmc"]` either way round. */
const canonical = (value: unknown): string =>
  JSON.stringify(Array.isArray(value) ? [...value].map(v => JSON.stringify(v)).sort() : value);

/** Expected arguments are a subset: each one given must match exactly. */
function argsMatch(expected: Record<string, unknown> | undefined, actual: unknown): boolean {
  if (!expected) return true;
  const got = (actual ?? {}) as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => canonical(got[key]) === canonical(value));
}

/**
 * `first` is the first tool called; `sequence` is tools called in that order,
 * not necessarily adjacent; `args` must match on the first call to the first
 * expected tool — the others are free.
 */
export function scoreSelection(c: SelectionCase, calls: readonly Call[]): { pass: boolean; why?: string } {
  const names = calls.map(call => call.name);
  if (c.expect.first && names[0] !== c.expect.first) {
    return { pass: false, why: `first call ${names[0] ?? 'none'}, expected ${c.expect.first}` };
  }
  if (c.expect.sequence) {
    let at = 0;
    for (const name of names) if (name === c.expect.sequence[at]) at++;
    if (at < c.expect.sequence.length) return { pass: false, why: `no ${c.expect.sequence[at]} in ${names.join(' → ') || 'no calls'}` };
  }
  const target = c.expect.first ?? c.expect.sequence?.[0];
  const call = calls.find(x => x.name === target);
  if (!argsMatch(c.expect.args, call?.input)) return { pass: false, why: `arguments were ${JSON.stringify(call?.input)}` };
  return { pass: true };
}

export type ReadingCase = { id: string; split: 'tune' | 'holdout'; paper: string; question: string; answers: string[] };

const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s,]+/g, ' ').replace(/[.\s]+$/, '').trim();

/** The last `Answer:` line, compared exactly (after normalising) with the accepted forms. */
export function scoreReading(answers: readonly string[], text: string): { pass: boolean; why?: string } {
  const given = [...text.matchAll(/^\s*\**Answer:?\**:?\s*(.+)$/gim)].pop()?.[1]?.replace(/\*+/g, '').trim();
  if (!given) return { pass: false, why: 'no Answer: line' };
  return answers.some(a => normalize(a) === normalize(given)) ? { pass: true } : { pass: false, why: `answered ${given}` };
}

export type ReferenceItem = { text: string; planted: string; accept: string[] };

const FLAGS = new Set(['ambiguous', 'mismatch', 'not_found']);
const REAL = new Set(['none', 'closed_real', 'preprint_version']);

/**
 * Recall per planted type; precision of the flags (of the references the tool
 * flagged, how many had something wrong); and the false-fabricated rate — real
 * papers called not_found or mismatch, the error that hurts users most.
 * `not_checked` is not a verdict: it is counted and re-run, never scored.
 */
export function scoreReferences(items: readonly ReferenceItem[], verdicts: readonly string[]) {
  const byType: Record<string, { correct: number; total: number }> = {};
  const misses: Array<{ text: string; planted: string; verdict: string }> = [];
  let flagged = 0, rightlyFlagged = 0, real = 0, falseFabricated = 0, notChecked = 0;
  items.forEach((item, i) => {
    const verdict = verdicts[i] ?? 'not_checked';
    if (verdict === 'not_checked') {
      notChecked++;
      return;
    }
    const type = (byType[item.planted] ??= { correct: 0, total: 0 });
    type.total++;
    if (item.accept.includes(verdict)) type.correct++;
    else misses.push({ text: item.text, planted: item.planted, verdict });
    if (FLAGS.has(verdict)) {
      flagged++;
      if (!REAL.has(item.planted)) rightlyFlagged++;
    }
    if (REAL.has(item.planted)) {
      real++;
      if (verdict === 'not_found' || verdict === 'mismatch') falseFabricated++;
    }
  });
  return {
    recallByType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.total ? v.correct / v.total : 0])),
    flagPrecision: flagged ? rightlyFlagged / flagged : 1,
    falseFabricatedRate: real ? falseFabricated / real : 0,
    notChecked,
    misses
  };
}
