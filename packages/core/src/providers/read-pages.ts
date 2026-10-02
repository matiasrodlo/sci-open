/**
 * Reading `depth` records from an API whose pages are smaller than `depth`.
 *
 * `fanOut` asks each provider once, for `depth` records — 600 by default. A
 * provider whose `capabilities.maxPageSize` is below that clamps the request
 * and returns a page, and `ProviderReport` records `status: 'ok'` beside
 * `retrieved: 100`. That reads as "this is what the provider had", and it is
 * not: it is what one page of it holds. The shortfall is invisible in the
 * response, and it moves `total`, the facets and the ranking, because a paper
 * that was never fetched cannot be merged, counted or ranked.
 *
 * `providers/openalex/index.ts` solved this for itself, and its header explains
 * why it had to: the old path paginated to 600 and the rewrite did not, which
 * cost 12,000 records against 4,200 across a 22-query sweep. This is the same
 * fix, factored out, for the two other providers in the keyword fan-out whose
 * page is smaller than the depth — DOAJ and OpenAIRE, both capped at 100.
 *
 * **Two rounds, not `pageCount` of them and not one each.** OpenAlex issues
 * every page at once, on the grounds that walking them in sequence puts a full
 * round trip on the critical path per page. That is right about sequential
 * reads and it over-corrects: with all pages issued blind, a query matching 40
 * records still costs six requests, five of which are answered empty. Here the
 * first page is read, and what it reports about the size of the corpus decides
 * how many more are worth asking for — so a narrow query costs exactly one
 * request and a broad one costs two round trips rather than six. Both providers
 * declare `reportsTotal: true`, which is what makes that decidable.
 *
 * **A short page ends the read.** A provider that returns fewer records than it
 * was asked for has no more to give, whatever it said its total was, so nothing
 * further is requested.
 *
 * **A failed page fails the whole read**, by letting the rejection out of
 * `Promise.all`. That discards the pages that did succeed, and it is deliberate
 * for the reason OpenAlex states: `ProviderReport` has no way to say "short by
 * 400", so returning a partial read would report it as a complete one — which
 * is the silent shortfall this module exists to remove, arriving by a different
 * route.
 */

export type ReadPagesOptions<Payload, Item> = {
  /** Records the orchestrator asked for. `depth`. */
  wanted: number;
  /** The largest page this API serves. `capabilities.maxPageSize`. */
  perPage: number;
  /** Where the read starts. */
  offset: number;
  fetch(args: { pageSize: number; offset: number }): Promise<Payload>;
  itemsOf(payload: Payload): Item[];
  /** The provider's own count of everything matching, where it reports one. */
  totalOf(payload: Payload): number | undefined;
  /**
   * Whether the final request may ask for only the records still wanted,
   * rather than a full page that is then trimmed. Off by default.
   *
   * It depends on how the provider addresses a read, and the two shapes are
   * not interchangeable. DOAJ and OpenAIRE derive a **page number** from
   * `offset / pageSize`, so a request whose size differs from its neighbours'
   * lands on a different page than the arithmetic intends — which is why
   * OpenAlex, addressed the same way, states that every request asks for a full
   * page. NCBI takes `retstart`, an absolute record offset, so the size of a
   * request says nothing about where it starts and the last one is free to be
   * short.
   *
   * Worth having only where the surplus is expensive. At `depth` 600 against a
   * 500-record page, a full second page fetches 1,000 records to return 600 —
   * and for NCBI those are abstract XML, the bulkiest payload of any provider
   * and the thing its page ceiling exists to bound in the first place.
   */
  exactLastPage?: boolean;
};

export type PagesRead<Item> = {
  items: Item[];
  /** The corpus-wide count, as the provider reported it. */
  total?: number;
  /** Requests this read cost. Reported so a test can pin the request count. */
  requests: number;
};

export async function readPages<Payload, Item>(
  options: ReadPagesOptions<Payload, Item>
): Promise<PagesRead<Item>> {
  const { offset, fetch, itemsOf, totalOf, exactLastPage = false } = options;
  const wanted = Math.max(options.wanted, 1);
  const perPage = Math.max(options.perPage, 1);

  const first = await fetch({ pageSize: perPage, offset });
  const firstItems = itemsOf(first);
  const total = totalOf(first);

  const done = (items: Item[], requests: number): PagesRead<Item> => ({
    items: items.slice(0, wanted),
    ...(total !== undefined ? { total } : {}),
    requests
  });

  // One page was the whole request, or the provider has nothing further: a page
  // shorter than the one asked for is the end of the results by any API's
  // convention, and is trusted over a reported total that disagrees.
  if (firstItems.length >= wanted || firstItems.length < perPage) {
    return done(firstItems, 1);
  }

  const byWanted = Math.ceil(wanted / perPage);
  // What is actually there to read, from where this read started. Without it a
  // 40-hit query would still pay for `byWanted` pages of empty answers.
  const byCorpus =
    total !== undefined ? Math.ceil(Math.max(total - offset, 0) / perPage) : byWanted;
  const pages = Math.min(byWanted, byCorpus);

  if (pages <= 1) return done(firstItems, 1);

  // The remainder goes out together — the objection to sequential reads is
  // sound, and this is two rounds rather than `pages` of them.
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => {
      const page = index + 1;
      const remaining = wanted - page * perPage;
      return fetch({
        pageSize: exactLastPage ? Math.max(Math.min(perPage, remaining), 1) : perPage,
        offset: offset + page * perPage
      });
    })
  );

  return done([firstItems, ...rest.map(itemsOf)].flat(), pages);
}
