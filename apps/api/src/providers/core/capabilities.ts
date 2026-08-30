import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the CORE v3 API can do, and what it is fast enough to be asked.
 *
 * An API key was obtained and changed nothing that mattered: it authenticates
 * (a wrong key answers 401 in 0.6s), but the rate limit stays at
 * `x-ratelimit-limit: 10` and the latency does not improve. CORE is simply
 * slow, and erratically so — ten samples for three records ran 8.6s, 11.8s,
 * 13.7s, 18.9s, 25.0s, 32.0s, 34.6s, 38.2s, 42.7s and one HTTP 500, with 25
 * records timing out at 120s. Roughly four in ten keyword searches land inside
 * the orchestrator's 20s per-provider budget.
 */
export const capabilities: ProviderCapabilities = {
  /**
   * Off, on latency rather than on quality.
   *
   * A provider that misses the budget six times in ten does not simply
   * contribute less — it marks most searches `complete: false`, which is the
   * signal that something went wrong. Spending that signal on a provider known
   * to be slow makes it useless for the cases it exists to flag. Nothing else
   * suffers: the fan-out is parallel and aborts at the budget, so a slow
   * provider costs its neighbours nothing.
   */
  keywordSearch: false,

  /**
   * On, and this is what CORE is for. A DOI lookup returns one record and was
   * measured inside the budget every time — 5.9s, 12.9s, 15.9s, 15.9s, median
   * 14.4s. CORE aggregates repository deposits, so its value is finding a
   * readable copy of a paper already identified, which is exactly this case.
   */
  doiLookup: true,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    'publisher',
    'language',
    'fullText',
    'landingPage'
  ],

  // `yearPublished>=2022 AND yearPublished<=2023` in `q` narrows 60,460 to
  // 15,589. Note this is the query, not the `filters` parameter the old
  // connector used, which CORE ignores.
  yearFilter: true,

  // The largest page verified to come back at all, and a latency ceiling
  // rather than a documented cap — 50 failed and 100 timed out, with a key and
  // without. A DOI lookup needs far less than this.
  maxPageSize: 25,

  // `totalHits`.
  reportsTotal: true,

  // The field exists and was 0 on every record measured, across the recorded
  // page and a 25-record sample. Claiming it would put a column of zeros into
  // the citations sort.
  suppliesCitations: false
};
