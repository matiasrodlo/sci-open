import type { Call } from './run';

export type SelectionCase = {
  id: string;
  split: 'tune' | 'holdout';
  /** Toolsets the server is started with; the default ones when absent. The
   * opt-in tools are only chosen where a client has turned them on. */
  toolsets?: string;
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

/** verify_references' verdicts, as a model checking references with another
 * server's tools is asked to give them (the thresholds of `judge`, in words). */
export const VERDICT_MEANINGS: Readonly<Record<string, string>> = {
  verified: 'a real paper whose title, authors and year agree with the reference',
  likely: 'a real paper whose title is close but not exact, with nothing that contradicts it',
  ambiguous: 'a real paper may be meant, but its year or its authors disagree with the reference, or only part of the title matches',
  mismatch: 'the DOI is wrong: it names a different paper, or no paper at all while the rest of the reference names a real one',
  not_found: 'no source holds a paper like it'
};

/**
 * The `Verdict <n>: <word>` lines a model ended with, one per reference. A
 * reference it gave no line for, or a word that is not a verdict, is
 * `no_verdict`: scored wrong, as a reader would count it, never flagged and
 * never called fabricated. The last line for a number wins.
 */
export function parseVerdicts(text: string, count: number): string[] {
  const given = new Map<number, string>();
  for (const [, n, word] of text.matchAll(/^\s*\**\s*Verdict\s+(\d+)\s*\**\s*:\s*\**\s*([a-z_]+)/gim)) {
    given.set(Number(n), word!.toLowerCase());
  }
  return Array.from({ length: count }, (_, i) => {
    const word = given.get(i + 1);
    return word && word in VERDICT_MEANINGS ? word : 'no_verdict';
  });
}

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
    notChecked
  };
}
