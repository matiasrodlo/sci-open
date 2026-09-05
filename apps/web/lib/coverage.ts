import type { ProviderTotal } from '@open-access-explorer/shared';

/**
 * What the reported total is a total *of*.
 *
 * `SearchResponse.total` is the length of the filtered set, and the filtered
 * set is built from a fixed number of records per provider — `DEFAULT_DEPTH`,
 * 600 — not from everything that matched. The header called that number
 * "retrievable open-access papers", which reads as a count of the corpus, and
 * it is not one. Measured on `ai`, minutes apart, same query, same day:
 *
 * | providers that answered | reported total |
 * |---|---|
 * | 3 | 1,716 |
 * | 5 | 2,891 |
 *
 * The number moved by 1,175 because two more sources answered, not because two
 * more days of literature appeared. It is `depth × providers that answered`,
 * less duplicates and less what the gates dropped, and a reader had nothing to
 * tell them that. The warning banner did not help: it appears only when a
 * provider fails, so its absence read as "this count is complete", when a
 * healthy search is bounded by depth in exactly the same way.
 *
 * So the header says what the number is, and it needs two facts from the
 * per-provider reports to do it.
 */
export type Coverage = {
  /**
   * True when at least one source held more matches than this search read from
   * it — which is when `total` is a window and not an answer.
   *
   * False for a query narrow enough that every source was read to the end. The
   * count really is the whole set then, and saying otherwise would be its own
   * kind of lie.
   */
  truncated: boolean;
  /**
   * A floor on how many papers match, across all of them: the largest single
   * source's count.
   *
   * The largest rather than the sum, for the reason `ProviderCoverage` gives
   * for never adding these up — the corpora overlap heavily, so a sum counts
   * the same paper several times. The largest is the one figure that is
   * certainly not an overstatement: the union is at least as big as its biggest
   * member. Hence the `+`.
   *
   * Absent when nothing was truncated, and when no source reported a total at
   * all (bioRxiv declares `reportsTotal: false`, and a failed provider reports
   * nothing).
   */
  matching?: number;
};

/**
 * The count, said in words that are true of it.
 *
 * Two readings, and which one applies is `coverage.truncated`. When a source
 * held more than was read, the number is what came back and the corpus figure
 * is a separate, larger thing, so both are named. When every source was read to
 * the end, the number really is the set and gets said plainly.
 *
 * A string rather than markup because it is one phrase either way, and because
 * a phrase is testable — including the singular, which the old wording got
 * wrong in a way nobody would notice until a DOI lookup matched one paper and
 * the header said "1 retrievable open-access papers".
 */
export function totalLabel(total: number, coverage: Coverage): string {
  const count = total.toLocaleString();

  if (!coverage.truncated) {
    return `${count} open-access ${total === 1 ? 'paper' : 'papers'}`;
  }

  return coverage.matching === undefined
    ? `${count} retrieved`
    : `${count} retrieved of ${coverage.matching.toLocaleString()}+ matching`;
}

/**
 * How `toSearchResponse` spells a skip.
 *
 * `ProviderTotal` has one field for "why this contributed nothing", so a skip
 * travels as a prefixed `error`. The prefix is the only thing separating "we
 * chose not to ask" from "we asked and it broke", and it was being compared
 * against a string literal at three call sites. One place knows the encoding.
 */
const SKIPPED = 'skipped: ';

/** Declined to guess: never asked, and not a sign of anything wrong. */
export function isSkipped(provider: ProviderTotal): boolean {
  return provider.error?.startsWith(SKIPPED) ?? false;
}

/** Asked, and did not answer. The one that makes the total a lower bound. */
export function isFailed(provider: ProviderTotal): boolean {
  return provider.error !== undefined && !isSkipped(provider);
}

/**
 * Skipped providers grouped by the reason they gave, in first-appearance
 * order.
 *
 * Grouped because the reasons repeat — six providers decline a DOI query for
 * one reason between them — and six lines saying the same thing is worse than
 * one line naming six providers. It is also why this cannot go back to a
 * single hardcoded sentence: on a keyword query the three that decline give
 * three different reasons, and only one of them is the one the panel used to
 * print for all of them.
 */
export function skipsByReason(
  providers: readonly ProviderTotal[]
): Array<{ reason: string; sources: string[] }> {
  const groups = new Map<string, string[]>();

  for (const provider of providers) {
    if (!isSkipped(provider)) continue;
    const reason = provider.error!.slice(SKIPPED.length).trim();
    const sources = groups.get(reason);
    if (sources) sources.push(provider.source);
    else groups.set(reason, [provider.source]);
  }

  // `Array.from` rather than a spread over the Map's iterator, which this
  // package's compilation target does not allow.
  return Array.from(groups, ([reason, sources]) => ({ reason, sources }));
}

/**
 * Reads the per-provider reports for what the header needs.
 *
 * A provider that errored or was skipped is ignored: it retrieved nothing and
 * its corpus count is unknown, so it can neither prove the read was truncated
 * nor raise the floor. That a failed source *also* makes the total a lower
 * bound is a separate statement, made separately — see `ProviderCoverage`.
 */
export function coverageOf(providers: readonly ProviderTotal[]): Coverage {
  const answered = providers.filter(p => !p.error && typeof p.totalHits === 'number');

  const truncated = answered.some(p => p.totalHits! > p.retrieved);
  if (!truncated) return { truncated: false };

  const matching = Math.max(...answered.map(p => p.totalHits!));

  // Zero is a real count — PLOS answers `ai` with it — but it cannot be a floor
  // that says anything, and `truncated` cannot be true on a zero-hit provider
  // anyway. Guarded so an odd report cannot put "0+ matching" on the page.
  return matching > 0 ? { truncated, matching } : { truncated };
}
