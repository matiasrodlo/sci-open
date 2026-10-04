import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

export type CaseRecord = {
  id: string;
  pass: boolean;
  why?: string;
  calls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  ms: number;
  stopReason: string;
  models: string[];
  fallbackTurns: number;
  /** What the case's calls asked of the sources, from a server that says. */
  upstreamRequests?: number;
  openalexCostUsd?: number;
};

/**
 * One JSON file with every case and one Markdown table per run, dated, under
 * `results/`, which is committed: the published numbers and their history. A
 * case the fallback model answered is reported but not scored.
 */
export function writeReport(
  suite: string,
  split: string,
  cases: readonly CaseRecord[],
  extra: Record<string, unknown> = {},
  /** Added to the file name, for a run against a baseline. */
  label = ''
): string {
  const date = new Date().toISOString().slice(0, 10);
  const scored = cases.filter(c => c.fallbackTurns === 0 && c.stopReason !== 'refusal');
  const passed = scored.filter(c => c.pass).length;
  const mean = (f: (c: CaseRecord) => number) => (scored.length ? scored.reduce((n, c) => n + f(c), 0) / scored.length : 0);
  const summary = {
    suite, split, date,
    cases: cases.length,
    scored: scored.length,
    ...(cases.length
      ? {
          accuracy: scored.length ? passed / scored.length : 0,
          meanCalls: mean(c => c.calls),
          meanInputTokens: mean(c => c.inputTokens),
          meanOutputTokens: mean(c => c.outputTokens),
          meanCacheReadTokens: mean(c => c.cacheReadTokens),
          // Only from a server that reports it: a baseline's absence is not zero.
          ...(scored.some(c => c.upstreamRequests !== undefined)
            ? { meanUpstreamRequests: mean(c => c.upstreamRequests ?? 0), meanOpenAlexCostUsd: mean(c => c.openalexCostUsd ?? 0) }
            : {})
        }
      : {}),
    ...extra
  };

  const dir = path.join(__dirname, '..', 'results');
  mkdirSync(dir, { recursive: true });
  const base = `${date}-${suite}-${split}${label ? `-${label}` : ''}`;
  writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify({ summary, cases }, null, 2)}\n`);

  const value = (v: unknown) =>
    typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : typeof v === 'string' ? v : JSON.stringify(v);
  const md = [
    `## ${suite} (${split}${label ? `, ${label}` : ''}), ${date}`,
    '',
    '| Metric | Value |',
    '|---|---|',
    ...(cases.length
      ? [
          `| Accuracy | ${((summary.accuracy ?? 0) * 100).toFixed(1)}% (${passed}/${scored.length}) |`,
          `| Mean tool calls | ${(summary.meanCalls ?? 0).toFixed(2)} |`,
          `| Mean input / output tokens | ${Math.round(summary.meanInputTokens ?? 0)} / ${Math.round(summary.meanOutputTokens ?? 0)} |`,
          `| Mean cache-read tokens | ${Math.round(summary.meanCacheReadTokens ?? 0)} |`,
          ...(summary.meanUpstreamRequests !== undefined
            ? [
                `| Mean requests to the sources | ${summary.meanUpstreamRequests.toFixed(1)} |`,
                `| Mean OpenAlex cost | $${(summary.meanOpenAlexCostUsd ?? 0).toFixed(4)} |`
              ]
            : []),
          `| Answered by a fallback model, or refused (not scored) | ${cases.length - scored.length} |`
        ]
      : []),
    ...Object.entries(extra).filter(([k]) => k !== 'misses').map(([k, v]) => `| ${k} | ${value(v)} |`),
    '',
    '### Failures',
    ...scored.filter(c => !c.pass).map(c => `- ${c.id}: ${c.why ?? ''}`),
    ...((extra.misses as Array<{ text: string; planted: string; verdict: string }> | undefined) ?? [])
      .map(m => `- ${m.planted}, graded ${m.verdict}: ${m.text}`)
  ].join('\n');
  writeFileSync(path.join(dir, `${base}.md`), `${md}\n`);
  return md;
}
