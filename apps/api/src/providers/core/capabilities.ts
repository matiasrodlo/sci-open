import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the CORE v3 API can do, measured anonymously.
 *
 * CORE is **not registered in the orchestrator**, and the reason is latency
 * rather than any of these capabilities. Measured on the anonymous tier: 3
 * records took 18.9s, 25 records took 35.6s, 50 records failed, and 100
 * records timed out at 90s even with `exclude=fullText`. The orchestrator
 * allows a provider 20s. CORE would exceed that on every request at any useful
 * depth, so registering it would add a provider that only ever reports a
 * timeout.
 *
 * Whether an API key removes that is untested and plausible — anonymous tiers
 * are commonly throttled, and the same tier is capped at 10 requests per
 * roughly five minutes. Re-measure with a key before registering.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,

  // `doi:"10.1038/srep09811"` returns exactly 1.
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

  // The largest page verified to come back at all. 50 failed and 100 timed
  // out; this is a latency ceiling rather than a documented cap, so it is
  // worth re-measuring with a key.
  maxPageSize: 25,

  // `totalHits`.
  reportsTotal: true,

  // The field exists and was 0 on every record measured, across the recorded
  // page and a 25-record sample. Claiming it would put a column of zeros into
  // the citations sort.
  suppliesCitations: false
};
