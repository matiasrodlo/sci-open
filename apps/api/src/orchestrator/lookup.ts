import type { Paper, ProviderId } from '@open-access-explorer/shared';
import { parseQuery } from './parse-query';
import { PROVIDERS, type ProviderEntry } from './registry';

/**
 * One record, by the id the search results carry.
 *
 * The paper endpoint's whole job, and until this phase it was a hundred lines
 * of `if (source === …)` in the route, each branch reaching into a different
 * connector. What it actually needs is one question per provider — "give me
 * this record" — so that is what it asks, through the registry that already
 * knows how to drive each one.
 *
 * Two ways to ask, and which one applies is a fact about the provider's API
 * rather than a preference:
 *
 * - **A by-id endpoint**, where the provider has one. `ProviderEntry.lookup`.
 * - **The search endpoint**, otherwise. That is not a fallback for the three
 *   providers without a `lookup`: bioRxiv, DataCite and PLOS mint DOIs as
 *   native ids, so the id *is* a DOI lookup once `parseQuery` recognises it.
 *
 * The second branch used to carry arXiv, PubMed and Europe PMC as well, on the
 * grounds that they index their own ids as searchable text. Whether they do is
 * beside the point, because a native id reaches `translate` as an ordinary
 * term and comes back scoped to the fields a keyword belongs in — `(ti:… OR
 * abs:…)`, `(…[tiab] OR …[mh])`, `(TITLE_ABS:… OR MESH:… OR KW:…)` — none of
 * which contain an identifier. All three answered 404 for every record they
 * owned. They have `lookup` entries now.
 *
 * The old route took `results[0]` from whatever the search returned. This one
 * requires the record to be the record that was asked for, so a near miss is a
 * 404 rather than somebody else's paper.
 */

/**
 * bioRxiv and medRxiv are one API and one provider module, and records carry
 * the server that answered — so `medrxiv:…` is a real id with no registry
 * entry of its own.
 */
const PROVIDER_ALIASES: Partial<Record<ProviderId, ProviderId>> = { medrxiv: 'biorxiv' };

/** An id with no `source:` prefix that is unambiguously an arXiv identifier. */
const BARE_ARXIV_ID = /^\d{4}\.\d{4,5}(v\d+)?$/;

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * How many records to read when asking a search endpoint for one id.
 *
 * Small on purpose: the old route asked each connector for its default page
 * and returned the first record, so everything after the match was fetched and
 * discarded. A native id either matches near the top or is not in the index.
 *
 * Measured 2026-08-30, one lookup per provider against the live APIs: 165 ms
 * for arXiv, 365 ms PLOS, 476 ms bioRxiv, 732 ms OpenAlex, 759 ms DOAJ, 935 ms
 * PubMed, 1.1 s Europe PMC, 1.2 s DataCite, 2.8 s OpenAIRE. CORE is the
 * outlier at 2.3 to 17.2 s across four lookups of the same record, which is
 * the same instability phase 09 measured on its DOI lookups — over the budget
 * below it raises rather than answering "not found", because a provider that
 * was too slow to ask is not a paper that does not exist.
 */
const DEFAULT_DEPTH = 10;

export type PaperRef = {
  /** Absent when the id names no provider this service knows. */
  provider?: ProviderId;
  nativeId: string;
};

/**
 * `source:nativeId` -> its two halves.
 *
 * Split on the first colon only: DOIs and OpenAIRE's `doi_dedup___::…` both
 * contain colons of their own, and the provider prefix is the only one this
 * function owns.
 */
export function splitPaperId(id: string): PaperRef {
  const separator = id.indexOf(':');

  if (separator === -1) {
    return BARE_ARXIV_ID.test(id) ? { provider: 'arxiv', nativeId: id } : { nativeId: id };
  }

  return {
    provider: id.slice(0, separator) as ProviderId,
    nativeId: id.slice(separator + 1)
  };
}

export type LookupOptions = {
  timeoutMs?: number;
  /** Records read from a search endpoint when the provider has no by-id one. */
  depth?: number;
  userAgent?: string;
  /** Defaults to the whole registry. A subset is how this is driven offline. */
  providers?: readonly ProviderEntry[];
  now?: () => Date;
};

export async function lookupPaper(id: string, options: LookupOptions = {}): Promise<Paper | null> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    depth = DEFAULT_DEPTH,
    userAgent,
    providers = PROVIDERS,
    now
  } = options;

  const { provider, nativeId } = splitPaperId(id);
  if (!provider || !nativeId) return null;

  const entry = providers.find(p => p.id === (PROVIDER_ALIASES[provider] ?? provider));
  if (!entry) return null;

  if (entry.lookup) {
    const paper = await entry.lookup({
      nativeId,
      timeoutMs,
      ...(userAgent ? { userAgent } : {}),
      ...(now ? { now } : {})
    });

    return paper && matches(paper, provider, nativeId) ? paper : null;
  }

  // `parseQuery` is what turns a DOI-shaped native id into a DOI lookup, so
  // PLOS, DataCite and bioRxiv reach their providers' exact path without this
  // module knowing which ids are DOIs.
  const { papers } = await entry.search({
    query: parseQuery(nativeId),
    depth,
    offset: 0,
    timeoutMs,
    // A record is being asked for by id. Whether it is open access is a fact
    // about it, not a condition on finding it — and filtering upstream is how
    // a lookup returns nothing for a paper that plainly exists.
    openAccessOnly: false,
    ...(userAgent ? { userAgent } : {}),
    ...(now ? { now } : {})
  });

  return papers.find(paper => matches(paper, provider, nativeId)) ?? null;
}

/**
 * The record that was asked for, or nothing.
 *
 * Both branches above are checked, not just the search one. A by-id endpoint
 * looks like it cannot answer with the wrong record, and OpenAlex's does:
 * `works/W0000000000` is normalised to `W0` upstream and returns that record,
 * so an unchecked lookup answered a mistyped id with a real paper about
 * postpartum family planning in Ethiopia, under HTTP 200. Measured against the
 * live API on 2026-08-30. DOAJ, OpenAIRE and CORE are asked the same way and
 * get the same guard; `ProviderLookupArgs.nativeId` is the id as `SourceRef`
 * holds it, so a record that is the requested one carries it back unchanged.
 *
 * DOIs are case-insensitive in their suffix by convention and are compared
 * that way; everything else is compared as it stands.
 */
function matches(paper: Paper, provider: ProviderId, nativeId: string): boolean {
  const ref = paper.sources[0];
  if (!ref) return false;
  if (ref.provider !== provider) return false;
  return ref.nativeId === nativeId || ref.nativeId.toLowerCase() === nativeId.toLowerCase();
}
