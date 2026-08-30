# Thirteen phases, in order

*Execution runbook · sci-open gateway refactor*

Each phase has a gate that must be true before it starts, a concrete task list, and acceptance criteria you can check. Every phase is safe to stop after — the system works at the end of each one.

| Phases Done | Lines To Remove | Providers Migrated | Tests, From Zero | Flag-Gated Cutover |
|---|---|---|---|---|
| **9 / 13** | **4,564** | **10 / 10 · 4 authorities** | **795** | **1** |

> **Two rules for the whole runbook**
>
> **Never delete before you can detect a regression.** Phase 1 exists so that phase 2 is a refactor rather than a gamble. If you take one thing from this document, take the ordering of those two.
>
> **The old path stays alive until the new one is proven.** From phase 7 the two run side by side behind a flag, and the old code is not removed until phase 10.

> **Four claims that did not survive execution**
>
> Phases 00 and 01 are done, and running them against the tree disproved four things this document previously asserted. Each is corrected in place below, but they are worth reading together, because they are all the same kind of error — a plausible inference recorded as a measurement.
>
> **OpenAlex was not rate-limiting.** Tested directly: HTTP 200, 199,281 results, before and after the contact email was fixed. *It is now* — see the note under phase 08. The claim was true when measured and stopped being true; the correction is dated for that reason. **Unpaywall accepts the malformed address** the User-Agent parser produced — the parsing bug was real, the failure it was blamed for was not. **Abstract reconstruction does not drop repeated words**; all three implementations rebuild an inverted index correctly. And **the salvage anchor was a dangling commit** unreachable from `main`.
>
> Phase 01 found three defects this document did not know about, listed under the phases that will fix them. Every remaining measurement quoted here has now been reproduced live.

## Phase map

**GROUND** · `00` Stabilise the tree ✔ · `01` Safety net ✔ · `02` Delete ✔ · `03` Stop the bleeding ✔ · **BUILD** · `04` New contracts ✔ · `05` First provider ✔ · `06` Orchestrator ✔ · `07` Flag routing ✔ · `08` Migrate providers ✔ · `09` Authorities ✔ · **LAND** · `10` Cut over — *cache collapsed; cutover gated* · `11` Frontend · `12` Deploy hardening

## 00 · Stabilise the tree — *Done*

Everything after this rewrites files that had uncommitted changes in them. Get to a known-good, reproducible baseline first — and rescue the code that is about to be deleted.

> **Gate** — None. This was the starting point.

### What happened

- [x] **The working tree landed in seven commits.** 29 paths, reviewed in groups: the admin gate, the provider contract change, the web changes, the diagrams. `index.ts` was split by hunk so the security gate is its own reviewable commit rather than being buried inside the contract change.
- [x] **The stash was dropped.** Worth checking before deleting: it held 24 files of `.next` build output and `node_modules/.bin` symlinks, and no source at all.
- [x] **Ranking and enrichment salvaged** to `docs/salvage/`, with headers recording what to fix on the way back in.
- [x] **A real `UNPAYWALL_EMAIL` is set** and the User-Agent parsing is fixed, in one commit.
- [x] **The worktree is gone** — 544 MB freed — and `.claude/` is ignored.
- [x] **History rewritten.** `.git` went from **90 MB to 708 KB**: 228 MB of `node_modules` and 177 MB of `.next` stripped from 76 commits, against 3.6 MB of actual source. All 76 commits survive and the HEAD tree is byte-identical. Local `main` is now disjoint from `origin/main` and needs a force-push to publish.

> **Corrected here**
>
> **The salvage anchor was wrong.** This document said `search-pipeline.ts` was recoverable at `c9fd98c4`. That commit is *not reachable from `main`* — it belongs to a pre-rebase line duplicated onto main as `574c295d`, and `git gc` could have pruned it. It never mattered: the deletion was staged but not committed, so the file was sitting at `HEAD` the whole time.
>
> **The Unpaywall bug was real; its consequence was not.** The parser is at `clients/unpaywall.ts:66`, not `:62`, and it is worse than described — `split('mailto:')[1].split(' ')[0]` keeps the closing parenthesis, so the address was malformed whatever `UNPAYWALL_EMAIL` was set to. But Unpaywall accepts it and answers 200, and OpenAlex was never rate-limiting this service. Fixing the address is right for identification and the polite pool. It repaired no outage.
>
> **The worktree was provably safe to delete.** Its HEAD was detached and unreachable, which normally means check before deleting. `git diff ccab4445 HEAD` was empty — an identical tree — and a branch ref held the commits regardless.

## 01 · Build the safety net — *Done*

There were zero tests, no CI, and no lint config — the documented `pnpm lint` failed on an interactive prompt. Nothing after this phase was safe without it.

> **Gate** — Phase 00 complete; clean tree; build green.

### What happened

- [x] **154 tests across 15 files**, all offline, whole suite in about a second. The estimate here was ~45.
- [x] **Fixtures for nine of ten providers** — 200 KB committed, with a recording script so re-recording is deliberate and its diff reviewable. CORE is absent because it needs an API key.
- [x] **51 cases on the SSRF guard alone**, including cloud metadata, the addresses either side of every private range, IPv4-mapped IPv6 forms, and DNS rebinding where only the second resolved address is private.
- [x] **ESLint configured at the root;** `pnpm lint` no longer prompts, and runs in all four workspaces. Seven real errors fixed, including two `require()` calls that turned out not to be guarding an import cycle and a `@ts-ignore` that would have hidden the next error on that line.
- [x] **CI added** — typecheck, lint, test, build on every push and pull request, on Node 22.
- [x] **Every phase-02 deletion target is untested**, so the deletions are unblocked.

> **Corrected here**
>
> **Abstract reconstruction is not broken.** This document listed it as a known defect to pin as an expected failure. All three implementations rebuild a repeated word correctly; the tests now pin that behaviour instead. The other two nominated defects — the BibTeX backslash and the cache key against its invalidation pattern — were exactly as described.
>
> **Warnings do not fail lint yet.** There are 31, nearly all unused imports in modules phase 02 deletes, so they read as an inventory of dead code rather than a backlog. `--max-warnings 0` belongs here once that deletion lands. The audit job reports without blocking for the same reason: 107 advisories, 60 high, cleared in phase 12.

> **Three defects found that this document did not know about**
>
> **OpenAIRE drops the DOI.** It is in the payload under `pid[]` as `@classid`/`$`, the JSON API's attribute shape, and the connector reads `$.classid`/`_`, the xml2js one. Identical to the `bestaccessright` bug, in the single place it was not fixed — so OpenAIRE records cannot deduplicate by DOI, exactly the failure already known for PubMed. Fixed in phase 8.
>
> **`applyFilters` never reads `filters.oaStatus`.** It is declared on `SearchFilters`, it is in the documented request body, and the pipeline generates the facet listing its buckets — but a client filtering on it gets the unfiltered set back silently. Invisible today only because the UI does not render that facet. Fixed in phase 6.
>
> **Merging hides abstracts.** `preferCanonical` defaults true, so a secondary record's abstract goes to `canonicalAbstract` — and of the five `canonical*` fields written, only `canonicalVenue` is ever read back. When one provider has the record and another has the abstract, the merged result carries no abstract. The same shape as the `bestPdfUrl`/`pdfUrl` bug, in the fields beside it. Fixed in phase 6.

## 02 · Delete — *Done*

**Next.** 4,564 lines never execute or execute without effect — the four groups below, counted exactly. Removing them now means less surface to carry through the migration, and the 154 tests from phase 1 prove nothing broke.

> **Gate** — Phase 01 complete; CI green; every deletion target confirmed to have no inbound imports — and confirmed untested, which phase 01 verified.

### Tasks

1. **Unreachable modules — 550 lines.** `sources/crossref.ts` (shadowed by `lib/clients/crossref`), `lib/pdf.ts`, and `sources/unpaywall.ts` (whose only importer is `lib/pdf.ts`).
2. **Unused web components — 1,839 lines.** `CacheDashboard`, `SearchHelp`, `EnhancedPaperActions`, `EnhancedExportButton`, `SearchBar`, `SearchHistory`, `InfiniteResults`, `SearchExamples`. These are abandoned alternatives, not broken drafts — `InfiniteResults` is a working infinite scroll. Git remembers them if either feature is wanted back.
3. **Never-fed subsystems — 886 lines.** `cache-warmer.ts` (four `simulate*` methods that log and `setTimeout`), `performance-monitor.ts` (`recordPerformance` is never called, so it reports a permanent high-priority alert from zero samples), `api-cache-manager.ts` (one method ever called, always null). Remove the boot call and the admin routes with them.
4. **Source selection — 1,289 lines.** `source-prioritization`, `smart-source-selector`, `smart-source-config`, `query-analyzer`, plus the five `/api/smart-source/*` routes. Measured: it does not gate the fan-out. Its replacement is the capability model in phase 4.
5. **The load tester.** `http-performance-test.ts` fires 50 concurrent requests at four public APIs from inside the production server. Move to `apps/api/scripts/` or delete.
6. **Orphaned methods.** `RecordMerger.mergeRecords/selectBestRecord/scoreRecord`, `FallbackManager.executeWithEarlyReturn/getTelemetry`, `CrossrefClient.searchWorks`, `UnpaywallClient.resolveDOIs/getLicense/getOAVersion`, six `http-pool-config` exports, `cachePartialResults`, `getSourceLabel`, `clearPaperCache`.
7. **Dependencies.** Drop `crypto` (a deprecated npm squat shadowing the Node builtin), `http2-wrapper` (unused), `@radix-ui/react-toast` (never imported). Move `typescript`, `tailwindcss`, `postcss`, `autoprefixer` and the `@types` packages out of `dependencies` in `apps/web`.
8. **Decide `packages/search`.** Recommendation: delete. 521 lines reachable only from `seed.ts`, and non-functional against a live server on three counts. Removing it also drops three SDK dependencies and the typesense and meilisearch services from `docker-compose.yml`, taking local setup from three services to one.
9. **Sweep the leftovers.** The eight phantom sources in `merge.ts`'s priority map that have no connector; the four `(record as any).publisher` casts for a field that is already typed; the `// copy all methods from original SearchPipeline` comment pointing at a file that no longer exists.

### Done when

- [ ] All phase-1 tests still pass, unchanged.
- [ ] `pnpm build` green; both typechecks green.
- [ ] A manual search returns the same results as before the deletions.
- [ ] Source count is down roughly a quarter; `docker-compose up` starts one service.

> **Risk**
>
> Deleting something reachable by a path the import graph missed — dynamic `import()`, or a string-keyed lookup. Two mitigations: delete in the order above as separate commits, and run a real search after each. The `/api/paper/:id` route uses dynamic imports for its source branches, so check that specifically.

## 03 · Stop the bleeding — *Done*

Four fixes that are not superseded by the new architecture, and that between them account for most of what a user currently experiences as broken. Doing these now means the rest of the refactor happens on a system people can actually use.

> **Gate** — Phase 02 complete.

### Tasks

1. **Delete the abstract truncation.** `compressSearchResults` cuts every abstract to 500 characters on cache write and the matching decompress is a no-op — so the first visitor gets full text and everyone after gets a fragment cut mid-word. One deletion.
2. **Add a single-flight guard** on the search cache key. Four identical concurrent requests currently run four full nine-provider fan-outs. Worth doing on its own terms — four times the upstream traffic for one result — rather than to placate OpenAlex, which is not throttling this service.
3. **Truncate facets server-side** to what the panel renders. Re-measured during phase 01: **145.5 KB of facets behind 29.7 KB of results**, including a topics facet with **3,079 buckets** against a UI that shows 15. Roughly an 85% payload reduction, and the same reduction in every cached entry.
4. **Route logging through Fastify.** Delete the per-record connector logs — one search emits **4,428 lines**, 500 of them one per NCBI record. All of it is `console.*`, so `NODE_ENV=production` silences none of it. They are loud enough to drown the test output too.

> **Deliberately not in this phase**
>
> The page/sort cache-key fix — which is the single biggest latency win available — is *skipped here on purpose*. It gets solved properly and permanently by provider-level caching in phase 6. Patching the key now means doing the work twice.

### Done when

- [ ] A cached search returns identical abstracts to a fresh one.
- [ ] Four concurrent identical requests produce one upstream fan-out.
- [ ] A search response is under ~30 KB rather than ~170 KB.
- [ ] One search produces tens of structured log lines, not thousands of unstructured ones.

## 04 · Define the new contracts — *Done*

The types are the architecture. Nothing else moves until `Query`, `Paper`, `ProviderReport` and `ProviderCapabilities` are settled in `packages/shared` — the healthiest module in the repo, which both apps already compile against.

> **Gate** — Phase 03 complete. **Three design decisions resolved** — see the risk note below.

### Tasks

1. **Define `Query`.** The structured form providers translate from: `terms`, `phrases`, `join`, `years`, `doi`. Small on purpose — this is not a search grammar.
2. **Define `Paper`.** The common shape, with `sources: SourceRef[]` where `SourceRef = { provider, nativeId, rank, retrievedAt }`. That `rank` is load-bearing: it is provenance and it is the input to rank fusion in phase 6.
3. **Define `ProviderReport`.** `{ provider, status: 'ok'|'timeout'|'error'|'skipped', retrieved, totalHits?, error?, latency }` — the existing `ProviderTotal` plus a status, so a failed or skipped provider is visible rather than silent.
4. **Define `ProviderCapabilities`.** `keywordSearch`, `doiLookup`, `fields`, `yearFilter`, `maxPageSize`, `reportsTotal`, `suppliesCitations`. Keep it strictly descriptive — facts about what an API accepts, never predicted latency or coverage scores, or it becomes the thing phase 2 deleted.
5. **Write an adapter both ways.** `toOARecord(Paper)` and `fromOARecord(OARecord)`. This is what lets the new and old paths coexist from phase 7 without the frontend moving.

### Done when

- [ ] The new types compile and are exported from `packages/shared`.
- [ ] Both apps still build against the existing `OARecord` — nothing has migrated yet.
- [ ] Round-trip tests pass: `toOARecord(fromOARecord(x))` preserves every field the old shape carries.

> **Blocking decisions**
>
> **Field provenance shape.** Sidecar map (`fieldSources: { abstract: 'europepmc' }`) or per-field wrapper (`{ value, source }`)? Recommendation: sidecar — the wrapper is viral and changes every consumer, export and template for a benefit only the merge layer needs.
>
> **Is `openAccess` a boolean?** Recommendation: no. Keep `oaStatus` (Unpaywall's graded vocabulary) separate from `fullText: { url, kind, verified }`. Conflating them is why CORE advertises HTML reader pages as PDFs.
>
> **Are a preprint and its published version one paper?** Today they are two — different DOIs, often different years. Under a model whose premise is `sources: [...]`, users will expect one entry. Merging is better UX and needs version awareness. Settle it now: retrofitting means changing `id` generation, which everything keys on.

## 05 · First provider, end to end — *Done*

Prove the provider shape on one API before committing to it eleven times. Europe PMC is the right candidate: highest-yield contributor in testing, a sane JSON API, and it already reports totals honestly.

> **Gate** — Phase 04 complete; types stable.

### Tasks

1. **Create the provider layout.**

   ```
   apps/api/src/providers/europepmc/
     capabilities.ts   what this API can do
     translate.ts      Query → native query string    (pure)
     fetch.ts          native query → raw payload     (the only I/O)
     normalize.ts      raw → Paper[]                  (pure)
     index.ts          assembles the three
     __fixtures__/
   ```

2. **Move policy out.** The connector currently owns its own timeout, its own error swallowing and its own OA decision. Timeouts and error handling move to the orchestrator in phase 6; for now, expose them as parameters rather than constants.
3. **Populate provenance.** `normalize` sets `SourceRef` per record, including `rank` — the position in this provider's own result list.
4. **Fix the two known Europe PMC defects here.** The `landingPage` read that misses the `Array.isArray` guard applied thirty lines earlier (a `TypeError` whenever a record has exactly one full-text URL), and per-record normalisation isolation so one bad record costs one record.
5. **Write the parity test.** Same fixture through the old connector and the new provider; assert the new one produces at least the same records with at least the same fields populated.

### Done when

- [ ] `translate` and `normalize` have unit tests and touch no network.
- [ ] The parity test passes against the phase-1 fixture.
- [ ] A malformed record in the fixture costs exactly one record.
- [ ] The old Europe PMC connector is still in place and still used — nothing has switched yet.

## 06 · The orchestrator — *Done*

The largest phase, and the one that earns the refactor. A fan-out of one provider is still a fan-out — build the whole pipeline against Europe PMC alone before adding breadth.

> **Gate** — Phase 05 complete; one provider proven in the new shape.

### Tasks

1. **Plan.** Filter providers by declared capability against the query — a year bound excludes providers that cannot express one. No scoring, no prediction. Ship it querying *every capable provider*; add selection later only when `ProviderReport` yields evidence.
2. **Fan out.** Parallel, with an orchestrator-owned per-provider timeout and depth budget. Every outcome becomes a `ProviderReport` — including `skipped`.
3. **Provider-level cache.** Key on `(provider, translatedQuery, depth, normalizerVersion)`, with single-flight. **This is the structural fix** for the measured 29-second page-2 click: page, sort and post-fetch filter changes reuse the same provider responses and only the merge, rank and slice re-run. TTLs become per provider, and one failed provider can be retried without discarding the eight that succeeded.
4. **Merge and dedupe.** DOI first, then the identity rule decided in phase 4. Populate `fieldSources` as fields are chosen, and accumulate `sources[]` across the merged inputs. *This replaces the `canonical*` scheme*, where four of five fields are written and never read, so a merged-in abstract never reaches the record consumers actually see — the defect `fieldSources` exists to make structurally impossible.
5. **Rank.** Reciprocal rank fusion over `SourceRef.rank` (scale-free, so incomparable provider scores never get pooled), plus term overlap from the `Query` against title and abstract, title weighted higher. Use the salvaged `calculateRelevanceScore` as a tiebreaker — but remember it never looks at the query, so it is a quality signal, not relevance.
6. **Policy filter.** The OA and retrievability rules move here from the connectors, and become an explicit request option rather than an invisible hard rule. Wire up `filters.oaStatus` while you are here: it is declared, documented, faceted — and never read, so filtering on it silently returns everything.
7. **Facet, paginate, report.** Preserve the existing invariant: facets counted over the same filtered set that produced the hits, so buckets reconcile with the total. Add `complete: boolean` — if providers failed, `total` is a lower bound.

> **Pin this order**
>
> `plan → fan out → merge/dedupe → rank → filter → facet → paginate`. Ranking after pagination ranks a page; ranking before dedupe ranks duplicates.

### Done when

- [ ] The new path returns results for a fixed query set, with a `ProviderReport` per provider.
- [ ] Page 2 and a sort change are served from provider cache — milliseconds, not a re-fetch.
- [ ] Concurrent identical searches produce one upstream fan-out.
- [ ] Results are no longer contiguous provider blocks. Verify by run-length encoding the source sequence of a full result set — the current output is 13 blocks.
- [x] A forced provider failure appears as `status: 'error'` and sets `complete: false`. Measured during phase 01: Europe PMC returned `retrieved: 0` with no error on one run and 600 on the next, and nothing in the response distinguishes a timeout from an empty result. That is what this status field is for.

  > **The unforced case needed a fix the fan-out could not make.** A thrown error was always reported; a provider that answers HTTP 200 with something that is not a result page was not, because nothing threw. Observed live on 2026-08-29, during phase 08: Europe PMC served `{"version":"6.9"}` and nothing else — no `hitCount`, no `resultList` — for every query including `cancer`, and the provider read it as an empty corpus. `retrieved: 0`, `status: 'ok'`, `complete: true`: precisely the phase 01 symptom, reproduced. The same shape as the OpenAlex 429, which resolved as a success for the same reason. Each provider now checks that a 200 actually carried an answer, and a genuine empty result set — which still reports `hitCount: 0` — is untouched.
- [ ] Filtering by `oaStatus` changes the result set, and a merged-in abstract appears on the returned record.

> **Risk**
>
> **Ranking is a research problem wearing a task's clothing.** It is easy to spend the whole refactor tuning it. Timebox it: rank fusion plus title term overlap, shipped and measured, beats a better scheme that never lands. Everything else in this phase is verifiable; ranking quality is a judgement call, so give it an explicit stopping point.

## 07 · Route by flag — *Done*

Put the new path in front of real traffic without moving the frontend or committing to it.

> **Gate** — Phase 06 complete; new path returns sane results for the fixture query set.

### Tasks

1. **Dispatch in `POST /api/search`** on a config flag — old pipeline or new orchestrator.
2. **Convert on the way out** via `toOARecord`, so the response contract is byte-compatible and the frontend does not change.
3. **Add a comparison script.** Run a set of ~20 representative queries through both paths and diff: result count, overlap, ordering, per-provider contribution, latency. This is how you decide the new path is actually better rather than merely different.

### What happened

- [x] **`SEARCH_PATH` dispatches inside the single-flight block**, so both paths share the coalescing and the cache write and the flag changes only what runs. Verified live over HTTP: `X-Search-Path` on every reply, pagination and sort correct, `providerTotals` and `complete` populated. An unrecognised value falls back to `pipeline` rather than failing to boot.
- [x] **`from-search-params.ts` converts on the way in**, mirroring `to-search-response.ts` on the way out. It lives beside the orchestrator rather than in the route because the comparison script needs the same conversion — a harness that reimplemented it would measure something the service does not run.
- [x] **The frontend is untouched.** No file under `apps/web` changed, and the response is contract-identical apart from the additive `complete`. Not the same as having exercised the UI against both paths, which has not been done.
- [x] **`scripts/compare-paths.ts` runs 22 queries through both paths in process** and diffs count, set overlap, ordering, per-provider contribution, field completeness and latency. In process rather than over HTTP: going through the route would put the response cache between the harness and the thing being measured.
- [ ] **The new path does not yet match the old on count** — 600 against ~2,950 per query. Expected, and not resolvable until phase 08: nine providers against one. This box stays open by design.

### What the comparison found

- **Europe PMC is exactly at parity.** Old connector against new provider, called directly on 21 keyword queries: 100% overlap, Spearman 1.00, identical reported hit counts every time. The rewrite changed nothing about which records come back or in what order.
- **`venue` 0% → 99% and `citationCount` 0% → 100%**, on the same records. The old connector populated neither. Everything else — DOI 96%, abstract 91%, year 99%, topics 77%, landing page 100% — is unchanged.
- **Whole path: the new path is a strict subset.** ~100% of what it returns is also in the old path's set for every query. It finds real records; it finds fewer of them.
- **A DOI reaches the new provider as a DOI.** Given `10.1038/s41586-020-2008-3`, the old connector searched it as free text — 267 hits, 200 records returned. The new one translated it to `DOI:"..."` and returned the one record.

> **Two defects found here**
>
> **The Europe PMC year filter returned nothing at all.** `translate` emitted `PUB_YEAR:>=2022 AND PUB_YEAR:<=2024`. Europe PMC accepts that syntax, ignores it, and answers with the hit count of the unbounded query — 155,751 either way, against 58,349 for the correct `PUB_YEAR:[2022 TO 2024]`. The page then came back newest-first (585 of 600 from 2026), the orchestrator's own year filter discarded every record, and a year-bounded search returned zero results while `capabilities.yearFilter: true` claimed the bound had been applied upstream. Fixed here, with the range form and a test; the bounded query now reports 58,349 and returns only records in range. A silent-acceptance failure is the reason capabilities have to be checked against responses and not just documentation.
>
> **OpenAlex now meters requests, and one 429 takes the whole service down.** See phase 08. Twenty-two queries exhausted the daily budget mid-sweep, and every keyword search after that returned HTTP 500. The old path's numbers for the last five queries are therefore missing rather than low, and are excluded from the comparison above.

## 08 · Migrate the remaining providers — *Done*

Mechanical, independent, one at a time. Each provider lands with its own fixtures, its own tests, and the specific defect fixes it owns.

> **Gate** — Phase 07 complete; comparison script in place to catch regressions per provider.

### Order and the fix each one carries

1. **OpenAlex — done.** The 429 handling landed first because it was taking the service down; the migration waited for the daily budget to reset so a fixture could be recorded. The instruction below is *wrong in both halves*, which is worth keeping visible: add `host_venue` and `created_date` to the `select` list — or read `primary_location.source.publisher`, which is already selected. Today publisher is always empty for the largest provider and every record is stamped with the request time. **Handle 429 explicitly — this is now urgent rather than tidy.**

   > **`host_venue` does not exist, and neither does the substitute.** `select=host_venue` is answered with **HTTP 400** — `"host_venue is not a valid select field"` — so the publisher the old path read from `host_venue.publisher` was never going to arrive whatever the select list said. The suggested alternative, `primary_location.source.publisher`, is not a field either: the source object carries no such key. The publisher is `host_organization_name`, populated on every record measured. `created_date` is a real field but the wrong one — it is when OpenAlex minted the record (2025 for a 2016 paper), not a publication date, so it is not requested at all.
   >
   > **`open_access.oa_status` is Unpaywall's vocabulary, reported directly** — a single live page returns `gold`, `green`, `hybrid` and `bronze`. The old path discarded it and wrote `oaStatus: 'published'` on every record: a *stage* wearing the route's name, which is precisely the conflation `Paper` splits into `stage` and `oaStatus`.
   >
   > **`topics` supersedes `concepts`** — 3 precise topics against 11 broad concepts on the same record. `keywords` is deliberately not folded in as well: that would put the count back to 14 and give up what the change was for.
   >
   > Smaller: the DOI was stored as a URL where every other provider stores `10.x/y`; the landing page was the OpenAlex record even when a DOI existed; and every `oa_url` was written to `bestPdfUrl` although one of the three recorded records points at a PMC article page rather than a file.
   >
   > **Its year filter is also broken, and was previously invisible.** `buildOpenAlexFilter` emits `publication_year:>=2022,publication_year:<=2024`, which OpenAlex rejects: **HTTP 400**, `"Value for param publication_year must be a number."` So every year-bounded search loses OpenAlex on the old path. This only became *visible* once the 429 fix made a non-2xx throw — before it, `validateStatus: status < 500` resolved the 400 as a success and it became the same `undefined` crash. Surfaced by the second comparison sweep, the first one run with a working budget.
   >
   > **OpenAlex meters requests now.** Measured 2026-08-29, during the phase 07 comparison sweep: once the daily budget is spent it answers `HTTP 429` with `{"error":"Rate limit exceeded","message":"Insufficient budget ... Resets at midnight UTC", retryAfter, creditsRemaining, ...}` and no `results` key. Twenty-two queries were enough to exhaust it.
   >
   > The service does not survive that. `http-client-factory.ts:98` sets `validateStatus: status < 500`, so the 429 resolves as a success; `discoverWorks` flattens the missing `results` into `undefined`; and `searchByKeywords` then throws `Cannot read properties of undefined (reading 'doi')` — **every keyword search returns 500 while the quota is spent**, even though the other eight providers answered normally. The last five keyword queries of the sweep failed this way.
   >
   > Degrading to the remaining providers, with OpenAlex reported as errored in `providerTotals`, is a shape the response already supports.
2. **arXiv — done.** Query translation: quote phrases, join terms with `AND`. `all:crispr gene editing` became `all:crispr OR all:gene OR all:editing` — measured at 23,510 hits whose top two results were *Primer on the Gene Ontology* and *Gene Ontology: Pitfalls, Biases, Remedies*, neither about CRISPR. The `AND` form returns 16, all on the subject.

   > **The year filter was worse than the OR join.** The connector built `submittedDate:[202201010000 TO *]`, and both bounds as two AND-ed clauses. arXiv answers a wildcard endpoint with **HTTP 500** and an error document in the feed; the connector's catch-all turned that into `{ records: [] }`, so **arXiv left every year-filtered search entirely and silently** — the same defect already known for DOAJ, in a provider this document did not flag. Both endpoints are now concrete, verified against responses: 16 hits narrow to 3, all in range.
   >
   > **That error document is shaped like a paper.** One entry, with a title (`Error`), an author (`arXiv api core`) and a summary. Nothing about it stops a normaliser accepting it, and at HTTP 200 the old connector would have returned it as a search result. The normaliser now recognises it and reports a provider error instead.
   >
   > **Two fields nobody was reading.** `arxiv:doi` carries the published version's DOI and `arxiv:journal_ref` the venue — 3 and 2 of 16 live entries. The old connector read neither, so an arXiv record fell back to a title-and-year identity key, and a preprint's submission year rarely matches its publication year: the same paper survived the merge as two results. `doiLookup` is now declared `false`, so a DOI lookup is skipped with the missing capability named rather than answered with a silent empty set.
3. **NCBI — done.** Extract the DOI from `ArticleIdList` — the loop walked past it, so PubMed records could not deduplicate against other providers. Map MeSH headings into `topics`. Use the real publication date. Consider `explicitArray: false` in xml2js to remove ~15 defensive `?.[0] ||` ladders.

   > **The DOI fix on its own changed nothing, and the reason is a second defect.** With DOIs extracted, Europe PMC and PubMed still shared **zero** of 192 and 200 DOIs on the same query, and nothing merged. `esearch` orders by PMID descending unless told otherwise — newest first, not most relevant. The same query returns `42662940, 42662918, 42662409` by default and `38786024, 27699445, 27059283` under `sort=relevance`, on an identical count of 13,508. PubMed was contributing its most *recent* matches while every other provider contributed its most relevant, and `SourceRef.rank` feeds reciprocal rank fusion — so this was not a worse relevance ordering, it was not a relevance ordering at all. With both fixed: 7 shared DOIs and 7 merged papers where there had been none.
   >
   > **MeSH alone would not have fixed topics.** PubMed assigns MeSH only once an article is indexed, and none of the three recorded articles carry any — while all three carry a `KeywordList`. Taking both means recent records get topics too; MeSH alone would have left them empty on exactly the records that were already failing. 25 of 25 live records now carry topics, against 0 before.
   >
   > **`explicitArray: false` was considered and declined.** The parity test needs the old normaliser and the new one to run against the same parsed fixture, and a repeated element is still an array under that option, so the unwrapping helper is needed either way. Three helpers collapse all ~15 ladders instead — including the one that called `String()` on whatever it found and then guarded against the literal `'[object Object]'` reaching a result title. A collective author, rendered blank by the old connector, is now named.
4. **DOAJ — done.** Parenthesise the field terms and join year bounds with `AND` — any year filter made DOAJ answer HTTP 400 and drop out silently. Stop treating `type: 'fulltext'` links as PDFs. Declare `yearFilter` honestly in capabilities.

   > **Two of the connector's field names were silently dead.** DOAJ accepts an unqualified field it does not know and answers HTTP 200 with zero results. Measured: `keywords:crispr` returns **0** against 8,467 for `bibjson.keywords:crispr`, and `year:2022` returns **0** against 1,153,036 for `bibjson.year:2022`. The old connector used both spellings — so a third of its OR clause matched nothing on every search, and its year filter could not have worked even without the 400 beside it. Every field is now fully qualified.
   >
   > **The 400 was a wildcard endpoint, the same trap as arXiv.** `bibjson.year:[2024 TO *]` is rejected; two concrete endpoints are not. So `yearFilter` is honestly **true**, not false as this document expected — a 7,738-hit query splits into 2,011 + 2,658 + 3,067 across three adjacent bounds. The old connector also joined its two bounds with `OR`, which matches everything either side of them.
   >
   > **DOAJ was sorted by date too.** The connector forced `sort=created_date:desc`; DOAJ's default is relevance. The same defect as PubMed, found by looking for it: the default returns a mix of 2021, 2022 and 2024 where the forced sort returns 2026 three times.
   >
   > **`language` was hardcoded `'en'`** under a comment saying DOAJ does not supply one. It is at `bibjson.journal.language`. A missing journal title fell back to the literal string `'DOAJ Journal'`, which is a fabricated venue.
   >
   > **The PDF fix is real in `Paper` and lost on the way out.** Not one link in the recorded page is a PDF and one is explicitly `text/html`, so `fullText.kind` is now `html` — but `toOARecord` maps `fullText.url` to `bestPdfUrl` whatever the kind, so the legacy shape still cannot express the distinction. The format is correct in the new model and flattened by the adapter, the same cost it already documents for `sources` and `fieldSources`. It resolves when the frontend moves onto `Paper` in phase 11.
5. **CORE — blocked, not done.** Accept `limit` and `offset` (it hardcodes 100). Reorder PDF resolution so the reader URL becomes `landingPage` and the last resort, not the advertised PDF for every record.

   > **Corrected: CORE does not require an API key.** Anonymous requests to `api.core.ac.uk/v3` answer **HTTP 200** — it is the placeholder `your_core_api_key_here` that produces **401**, because a wrong key is worse than no key, exactly as with DataCite. So "CORE is missing because it needs an API key" was wrong: what a key buys is rate limit, not access. A fixture is recorded and committed, and the normaliser is written and tested against it.
   >
   > **The syntax is now verified, and `translate` and `capabilities` are written.** With a fresh rate-limit window and spaced requests, every form was checked against a response: `crispr AND gene AND editing` returns **13,323** against **2,126,594** for the same words unjoined, so CORE ORs its terms exactly as arXiv did; `yearPublished>=2022 AND yearPublished<=2023` **in the query** narrows 60,460 to 15,589, while the `filters` request parameter the old connector used is **ignored silently** — bounded and unbounded both returned 60,460, so its year filter never did anything; and `doi:"10.1038/srep09811"` returns exactly 1. **Phrases cannot be expressed at all**: a bare quoted phrase answers **HTTP 500**, and `title:"gene editing"` returns 635,878, so the quotes are not honoured either. They are degraded to required words, and `capabilities` does not claim otherwise.
   >
   > **A key was obtained, and it changed nothing that mattered.** It authenticates — a wrong key answers 401 in 0.6s — but the rate limit stays at `x-ratelimit-limit: 10` and the latency does not improve. CORE is simply slow, and erratically so: ten samples for three records ran 8.6s, 11.8s, 13.7s, 18.9s, 25.0s, 32.0s, 34.6s, 38.2s, 42.7s and one HTTP 500, with 25 records timing out at 120s. Roughly **four in ten** keyword searches land inside the orchestrator's 20s per-provider budget.
   >
   > **So CORE is registered as `keywordSearch: false, doiLookup: true`** — the shape DataCite and bioRxiv already have, and decided the same way, on measurement. A provider that misses the budget six times in ten does not merely contribute less; it marks most searches `complete: false`, spending the signal that exists to flag real failures. A DOI lookup, by contrast, was inside the budget every time measured — 5.9s, 12.9s, 15.9s, 15.9s, median 14.4s — and it is what CORE is actually for: it aggregates repository deposits, so its value is finding a readable copy of a paper already identified. Verified in the fan-out: a DOI lookup returns one record in 5.4s carrying the publisher's own PDF, where the old connector would have advertised a `core.ac.uk/reader/` page.
   >
   > Nothing else suffers from the decision either way — the fan-out is parallel and aborts at the budget, so a slow provider costs its neighbours nothing.

### Done when (per provider)

- [ ] Fixtures committed; `translate` and `normalize` unit-tested offline.
- [ ] Parity test against the old connector passes, or the difference is a documented fix.
- [ ] The comparison script shows no regression in that provider's contribution.
- [ ] Capabilities declared truthfully — especially `yearFilter` and `maxPageSize`.

> **Risk**
>
> Upstream rate limits are a real constraint even though the 429 this document once attributed to OpenAlex never reproduced — phase 01 recorded nine providers' fixtures without hitting one. Recording fixtures and running comparison sweeps both generate real traffic against services that owe you nothing. Record once, cache aggressively, and keep the contact address correct from phase 00.

## 09 · Authorities and enrichment — *Done*

Restore the cross-source enrichment the previous rewrite lost. This is the second provider role — `lookup(doi) → AuthorityFacts`, consulted about works you have already found. (`Partial<Paper>` in the original sketch; the type is keyed on `ProvenancedField` instead, so an authority cannot contribute a field `fieldSources` has no way to attribute.)

> **Gate** — Phase 08 complete; all search providers migrated.

### Tasks

1. **Implement the authority interface** for Crossref, Unpaywall and OpenAlex — separate from the search interface, though OpenAlex implements both.
2. **Enrich the page, not the set.** Fan out, dedupe, rank, paginate — *then* enrich the ~20 records being returned. These are per-DOI lookups: enriching 2,388 records costs 2,388 requests; enriching a page costs 20.
3. **Record field provenance during enrichment.** This is where `fieldSources` earns its place — an abstract from Europe PMC, a PDF URL from Unpaywall, a citation count from OpenAlex, all on one merged paper.
4. **Fix OpenAlex DOI lookup.** Use `filter=doi:…`, not `search=doi:…` — the current call full-text-searches for the literal string and can return a different paper, which is then merged in as a peer of the correct one.
5. **Fix Crossref OA inference.** Take open-access status from Unpaywall's `is_oa` and graded `oa_status`, not from the presence of any license entry. `extractLicense` currently returns `'Custom License'` for anything that is not one of six recognised CC URLs, so all-rights-reserved works get marked `published`.
6. **Prefer repository PDFs over publisher PDFs.** Invert `getBestPdfUrl` and `preferPublisherPdf`. Publisher endpoints are the ones behind bot protection — measured, 3 of the top 5 results returned 403 or a redirect loop. Raise the proxy's redirect limit while you are in there. *Right conclusion, wrong mechanism: inverting on host type alone takes the page from 11/20 to 6/20. It reaches 19/20 only once the PMC download gate is rewritten — see below. Redirect limit raised 5 → 10.*
7. **Backfill citation counts** so the citations sort has data. No connector supplies one today; OpenCitations and Crossref both expose them. *"No connector supplies one" is stale — phase 08 measured the new path at 39%, from OpenAlex and Europe PMC. Crossref is what closes the rest of the gap; OpenCitations contributes 2–4 counts per hundred results.*

> **The eleventh provider was an authority all along.** The count said 10 / 11 migrated, and the missing one was OpenCitations — `keywordSearch: false` in the old registry, with a note saying it resolves citations for a known DOI. It has no search role to migrate, so phase 08's gate was already met and it lands here instead, as task 7.

### What happened

Four authorities — Crossref, OpenAlex, Unpaywall and OpenCitations — behind a second interface, `lookup(doi) -> AuthorityFacts`, consulted after pagination. `AuthorityFacts` is keyed on `ProvenancedField`, so every field an authority can contribute is by construction a field `fieldSources` can attribute.

`AuthorityCapabilities` splits `fields` from `authoritative`, and that split is the design. Filling a gap is safe; replacing a value several providers agreed on is not, and is only justified where the authority is definitionally right. Unpaywall is the only one that overwrites anything.

Measured over five queries and 100 results, authorities on against off, same fan-out from a shared cache:

| | before | after |
|---|---|---|
| `citationCount` | 45% | **89%** |
| `publisher` | 64% | **90%** |
| `oaStatus` | 64% | **90%** |
| `venue` | 86% | 90% |

Page one carries 9–19 papers out of 20 with two or more attributed fields.

### What the measurements overturned

**Preferring repository PDFs is right, and every reason given for it was wrong.** The instruction was to invert `getBestPdfUrl` because "publisher endpoints are the ones behind bot protection". Measured over twenty works offering both:

| choice | served a PDF |
|---|---|
| publisher location | 11 / 20 |
| repository location, as Unpaywall gives it | **6 / 20** |
| repository location, rewritten | **19 / 20** |

The premise holds — nine publisher fetches failed, all 403, from `academic.oup.com`, `onlinelibrary.wiley.com`, `mdpi.com`, `neurology.org`, `amjcaserep.com` and `content.iospress.com`, and all nine answer 403 to a full Chrome User-Agent too. But repository copies were *worse* until one host was handled: thirteen of the twenty repository URLs are `pmc.ncbi.nlm.nih.gov/articles/PMC…/pdf/…`, which answers **HTTP 200 `text/html`** with a "Preparing to download …" cookie gate, to every User-Agent tried, with no redirect to follow. Europe PMC mirrors PMC and serves the same articles ungated: rewriting those URLs returned a real PDF **8 / 8**, then **13 / 13**. `lib/pdf-url.ts` holds that rewrite, and the proxy applies it before validation so the substituted host is resolved and SSRF-checked like any other.

**"A PDF beats a landing page" is a coin flip, and was removed.** It was the other half of the `fullText` substitution rule and it sounds unarguable. Measured: 17 substitutions for **1 fixed and 1 regressed**, moving the page's download rate from 72% to 67%. The pairs it chose say why — `doaj.org` → `sciencedirect.com`, `doi.org` → `onlinelibrary.wiley.com`, `pubmed.ncbi.nlm.nih.gov` → `mdpi.com`. It was trading resolver URLs, which redirect and mostly work, for direct publisher URLs, which are the ones that 403. `kind` is not reliable enough to bet on either way: the `doaj.org` URLs are marked `html` and served real PDFs. An incumbent copy is now kept unless it is demonstrably not a copy at all.

**Crossref's OA inference was worse than described, and so was its PDF link.** `extractLicense` returns `'Custom License'` for anything outside six recognised CC URLs, and anything truthy became `oaStatus: 'published'`. Measured on `10.1002/adma.201907006`: Crossref carries exactly one license, `onlinelibrary.wiley.com/termsAndConditions#vor` — Wiley's all-rights-reserved terms — and Unpaywall answers `is_oa: false, oa_status: "closed"`. The confusion is licence for route: three of four works sampled carry a `content-version: tdm` licence, which grants text-mining rights to a machine and says nothing about readers. Crossref no longer claims `oaStatus` at all. Separately, `extractPdfLink` accepted any link whose `intended-application` was `text-mining` regardless of content type, so for `10.1016/j.cell.2014.05.010`, whose only such links are `text/plain` and `text/xml`, it wrote a plain-text URL into `bestPdfUrl`.

**OpenAlex's DOI lookup is also ten times cheaper.** `filter=doi:` versus `search=doi:` was a correctness fix — the old form full-text-searches for the literal string and can return a different paper. OpenAlex prices them differently and reports it in `meta.cost_usd`: the filter cost **$0.0001**, and the `search` form is billed at **$0.001**, measured back to back when the second was refused for want of the budget the first had left.

**OpenCitations' configured endpoint is dead, and its zero is not a count.** `OPENCITATIONS_BASE` is `opencitations.net/index/coci/api/v1`, which answers **301**, as does `opencitations.net/index/api/v2`; the live host is `api.opencitations.net/index/v2`. And a DOI it has never seen answers HTTP 200 with `[{"count": "0"}]` — the same body an uncited paper produces. A hard zero would put a value we cannot stand behind into the field the citations sort orders on, so nothing is claimed instead.

**Unpaywall no longer returns the author shape the old client read.** `UnpaywallResponse` declared `z_authors: { given, family, ORCID }` and the converter built `` `${author.given} ${author.family}` `` from it. All three recorded responses carry `raw_author_name` and no `given` or `family`, so that template produced the literal string `"undefined undefined"`, once per author, as a name. It ships no abstracts, topics or citation counts either, all three of which the old interface declared.

### Done when

- [x] A returned page carries `fieldSources` naming a different provider for at least two fields on at least one paper. **9–19 of 20 per page**, across five queries.
- [x] A DOI query returns one paper, not the right one plus a topically similar wrong one. `filter=doi:` returns `meta.count: 1`; three providers answering about one DOI collapse to a single paper, asserted in `search.test.ts`.
- [ ] Download success rate on a page of results measurably improves against the phase-0 baseline. **Not met, and the metric is confounded — see below.**
- [x] Sorting by citations reorders results. It had data before (45%) and has more now (89%); the ordering property is asserted directly.

> **The download criterion cannot be read against that baseline, for the same reason the ranking comparison could not.**
>
> Measured over five queries, 100 results, each distinct URL fetched once and requests to one host serialised — a first attempt probed both pages concurrently and measured the enriched page as worse, which was the harness sending publishers two requests at once and being 403'd for it:
>
> | page | served a PDF |
> |---|---|
> | old pipeline | 73% |
> | new path, enrichment off | 69% |
> | new path, enrichment on | 69% |
>
> **The old path wins because its page one is `europepmc x20`** — measured again here, on all five queries, the same single-provider block phase 01 recorded. Europe PMC's URLs are `europepmc.org/articles/PMC…?pdf=render`, which essentially always work, so scoring 73% is a property of returning one provider's records rather than of resolving copies well. The new path's page one carries four to six providers, and its download rate decomposes by who supplied the paper: **europepmc 42/45, arXiv 13/13, PLOS 9/9, OpenAIRE 21/26, PubMed 3/4, DOAJ 1/3.** A higher number against that baseline would mean the new path had stopped diversifying, exactly as a high `rho` would have meant it had stopped ranking.
>
> What is measurable: **enrichment is download-neutral** (69% either way) once the rule that failed was removed, and the PMC rewrite is a real gain that lands inside Unpaywall's URLs, where it is what stops preferring repositories from being a 6/20 regression.
>
> **What would actually move the number is a change to `Paper`.** Every remaining failure is a publisher 403 with a working alternative sitting in Unpaywall's `oa_locations`, and `fullText` holds one URL, so there is nothing for the proxy to fall back to. A ranked list of candidate copies, tried in order, is the fix; it is a shared-model change and belongs with the frontend move in phase 11.

> **Two costs this phase accepted rather than solved.**
>
> **Enriching the page cannot rescue a paper the page never contained.** `applyPolicy` runs before pagination and drops papers with no retrievable copy, so a paper whose only known PDF is one Unpaywall would have found is gone before an authority is asked. Enriching the whole set would fix it and is the 2,388-requests-per-authority cost this step exists to avoid.
>
> **A citations sort orders on what the providers supplied, not on what enrichment added.** Sorting runs before pagination and enrichment after it, so a count backfilled by Crossref or OpenCitations arrives too late to affect the order. `citationCount` is fill-only for exactly this reason: papers that had no count sort to the bottom and stay there, so no page except the last can show an order its own numbers contradict.

> **OpenAlex was rate-limited throughout.** Every measurement above was taken with its daily budget spent, so the authority reports it as errored and its contribution to the coverage numbers is zero. The numbers are therefore a floor: `citationCount`, `topics` and `oaStatus` should all read higher on a day with budget. `scripts/enrichment-report.ts` reproduces them.

## 10 · Cut over and delete the old pipeline — *Task 4 done; the cutover is gated*

Make the new path the only path.

> **Gate** — Phase 09 complete; comparison report favourable across the full query set; new path has run as default behind the flag for long enough to trust.

> **The first clean whole-path comparison — 2026-08-30, all ten providers, OpenAlex answering on both sides, zero budget errors.**
>
> | | old | new |
> |---|---|---|
> | Records returned | 58,029 | 42,830 |
> | Shared | | 29,880 — **70%** of what the new path returned |
> | Latency, median | 13,149 ms | **8,111 ms** |
> | `doi` / `venue` / `publisher` | 63% / 61% / 4% | **93% / 93% / 46%** |
> | `topics` / `citationCount` | 77% / 21% | **94% / 39%** |
>
> **The count gap is almost entirely deliberate, and one third of it is not.** Retrieved-record differences decompose as: DataCite **9,999 → 0**, skipped on evidence; arXiv **10,524 → 3,034**, which is the OR-to-AND fix removing records that were never matches; and OpenAlex **12,000 → 4,200**, which was the one piece of genuinely lost coverage — the old path paginates `discoverWorks` to 600 while `fanOut` asks once and OpenAlex caps a page at 200. **Since closed:** OpenAlex paginates internally now, so a re-run should show that third of the gap gone.
>
> Overlap has climbed across four sweeps as providers landed — 54%, 60%, 64%, **70%** — and `citationCount` nearly doubled against the old path, which can only get it from OpenAlex where the new path also has Europe PMC.
>
> **The one regression: CORE quadruples DOI-lookup latency.** Measured directly, same query, same single result: 9,280 ms with CORE against 2,095 ms without, and CORE itself accounted for 9,260 ms of it. It is registered `doiLookup: true` because its repository corpus is where an otherwise-unreadable paper turns up, but whether that is worth 7 seconds on every DOI lookup has not been measured and should be before this is called settled.
>
> **The ranking disagreement is not a defect, and the metric that reports it is misleading.**
>
> The sweep's `rho` and `top20` columns ran 0.05–0.87 with one negative, and 0/20 to 12/20 — which reads as the two paths disagreeing about page one. They do, and that is the point. **The old path does not rank at all.** `sortResults` answers `'relevance'` with `return records`, so its order is the order providers were concatenated in — OpenAlex's block, then each aggregator's. Verified live: the old path's page one run-length encodes to `europepmc x20`, twenty consecutive records from one provider, which is the phase 01 symptom "page one returning a single provider's records in one block" still present.
>
> So a high `rho` against it would mean the new path had stopped ranking too. Measured against the new path instead: page one carries six providers, every result on topic, the three multi-provider papers first, and `overlap` spreads across the set (79 papers at 1.00, 47 at 0.75, 69 at 0.50, 44 at 0.25, 16 at 0.00) rather than saturating. Score ties are small — 200 distinct scores over 255 papers, largest tie group 4 — and broken by quality then id.
>
> The sweep now prints that interpretation next to the columns, and `rank.test.ts` asserts the property directly: no provider may own more than half of page one. Phase 06 wrote that test against two providers and noted it would only mean something once more were migrated; it now runs against six.
>
> **Two things to settle before that comparison means anything.**
>
> **A full sweep costs more OpenAlex budget than a day holds, now that both paths use it.** The old path spends 3 requests per query and the new path 1, so 22 queries need ~88. Sweep 2 completed 21 queries on ~63 requests with a fresh budget; sweep 3, run after a day of migration probing, got **3 queries in** before `429 Insufficient budget` and produced confounded counts, latency and completeness — the old path looked *faster* only because OpenAlex was failing instantly instead of fetching three pages. Run the sweep as the first OpenAlex use of the day, or fund the account. A sweep that runs out mid-way does not degrade gracefully; it produces a report that looks like a comparison and is not one.
>
> **Read depth — fixed for OpenAlex, still open for the rest.** `fanOut` calls each provider once and every provider caps the request at its own `maxPageSize`, so a `depth` of 600 yields 600 from Europe PMC, PLOS, arXiv and DataCite, 500 from PubMed, 100 from DOAJ and OpenAIRE, and 30 from bioRxiv. OpenAlex capped at **200** against the old path's paginated 600, which the sweep measured as 12,000 records to 4,200 — the only part of the count gap that was lost coverage rather than a decision. **OpenAlex now paginates internally**: verified, a depth of 600 returns 600 records with continuous ranks, and no slower, because the pages go out together. The remaining caps are smaller in absolute terms and not yet measured as a shortfall.

### Tasks

1. **Flip the default**, leave the flag in place for one release as a rollback.
2. **Delete `enhanced-search-pipeline.ts`, the old connectors and the `OARecord` adapters** once the frontend is on `Paper` (phase 11) — or keep the adapter permanently if you prefer a stable external contract.
3. **Remove `fallback.ts`**, whose staged-fallback machinery only ever served DOI resolution and whose concurrency control was never wired up.
4. **Collapse the cache** to one manager: L1 memory plus L2 Redis, no L3 map. Express bounds in bytes rather than entries — L3 currently trims above 50,000 entries (≈7.9 GB at measured response sizes) and L1 caps at 10,000 keys (≈1.6 GB). Fix the key/invalidation mismatch: `generateKey` hashes away exactly the substrings `invalidatePattern` searches for, so every pattern invalidation is a no-op. Switch Redis `KEYS` to `SCAN`.

### What happened — task 4, the cache

Three levels became two, and the third turned out to be doing harm rather than nothing.

**L3 was silently defeating the TTLs of the other two.** It was a plain `Map` with no expiry; `set` wrote to all three levels and `get`, on missing L1 and L2, found the value in L3 and wrote it *back* into both. So once an entry reached L3 its TTLs stopped meaning anything and it was served indefinitely — **a search result cached once was never refetched.** The `l3` TTL in every strategy config, up to 24 hours, was declared and applied to nothing. Demonstrated against the old code before removal: after flushing both live levels, `get` still returned the value and repopulated L1 and L2 with it. This is not in the task list above because nobody had noticed it; the entry count was the visible symptom of a bug whose real cost was staleness.

**Bounds are in bytes.** `MemoryCache` replaces `node-cache`, holds a byte budget of 256 MB by default (`CACHE_MAX_BYTES`), and evicts least-recently-used, spending expired entries before live ones. A count is not a bound when the things counted are pages of search results: 10,000 keys and 50,000 keys were roughly 1.6 GB and 7.9 GB at the ~158 KB per page phase 01 measured, and nothing about either number said so.

**Invalidation addresses a subject.** The key is now `namespace:hash(subject)` plus `:hash(variant)`, so every page, sort and filter combination for one query sits under one prefix that the query itself derives. `invalidatePattern` is replaced by `invalidate(namespace, subject)`, which returns how many entries went — the old one was invisible precisely because it always removed nothing and said nothing. **Phase 01's `it.fails` test, marked "flips to passing when phase 10 collapses the cache", flips.**

**`invalidatePaperCache(paperId)` could not have worked even with the match fixed.** `cachePaperDetails` writes the same record three times — under its id, its DOI and its normalised title — and the old signature addressed only id-keyed entries. A reader arriving by DOI would have been served the stale record. It takes the record now, so the remaining gap is visible in the type.

**Redis is walked with `SCAN`.** The old code called `KEYS *pattern*` under a comment claiming it used SCAN. `KEYS` blocks the server for the length of the keyspace — a stall proportional to how well the cache is working.

Also gone: two bare `NodeCache` instances exported as `getSearchCache` and `getPaperCache` beside a `generateCacheKey` helper, all three described as "legacy ... for backward compatibility", all three imported by the route and never called by it. They cached nothing and were compatible with nothing. `node-cache` is no longer a dependency.

### Done when

- [ ] One search path. The flag is gone or defaulted permanently. **Gated — see below.**
- [x] Cache invalidation actually invalidates — assert it in a test. Phase 01's failing test now passes, alongside variant, cross-subject and Redis-level assertions.
- [x] No in-process mutable state remains in the request path, so the API is genuinely stateless.

> **What "stateless" had to mean, given two caches survive on purpose.**
>
> It cannot mean "no state" — the runbook keeps an in-memory L1, and the orchestrator keeps a provider cache. It means no state whose mutation changes an answer.
>
> The cache manager now stores serialised values and parses on read, so it hands out a fresh object by construction. The old L1 ran `useClones: false` and returned the stored reference to every caller; anything that sorted or mutated a cached response in place would have changed what the next reader saw. Serialising also makes the byte accounting exact rather than estimated, since the bytes counted are the bytes held.
>
> The provider cache still holds live `Paper` objects and hands the same ones to every caller, which is cheap and safe only while nothing downstream writes to them. Enrichment is the one step that writes to a paper and it copies first — an invariant of the pipeline rather than a property of one function, so it is asserted end to end through the cache rather than trusted: a search that enriches, then the same search served from the provider cache, and the second one gets the unenriched record back.
>
> Nothing adaptive remains. `httpPerformanceMonitor` is read only by the admin endpoints and never consulted to change which providers are asked — the scoring layer that did that was 1,553 lines deleted in phase 02, and it has not grown back.

> **The cutover is gated, and the gate is not satisfiable today.**
>
> Task 1 needs "comparison report favourable across the full query set". A full sweep needs roughly 88 OpenAlex requests and the budget was **$0** when this phase started, resetting at midnight UTC. Running it anyway is the failure this document already records: *"A sweep that runs out mid-way does not degrade gracefully; it produces a report that looks like a comparison and is not one."* Sweep 3 got three queries in and produced confounded counts, latency and completeness. So the sweep is the first OpenAlex use of the next day, or the account gets funded.
>
> Phase 09's numbers were taken under the same constraint and are a floor for the same reason.
>
> **Tasks 2 and 3 are gated behind task 1, not behind the sweep.** `fallback.ts` is imported by exactly one file — `enhanced-search-pipeline.ts` — which is still the default search path and is also what both comparison scripts and the parity tests measure against. Removing the staged-fallback machinery means either deleting the old pipeline, which waits for the frontend in phase 11, or rewriting a `resolveDoi` that is going to be deleted anyway. The second option is worse than it looks: it would change the behaviour of the path the sweep compares against, and invalidate the comparison the gate is waiting for.
>
> Task 4 was done first precisely because it is the one part of this phase that neither path's behaviour depends on. The cache sits under both.

## 11 · Frontend — *1 week*

Move the UI onto the richer response, and fix the interface defects that have nothing to do with the backend.

> **Gate** — Phase 10 complete; response shape stable.

### Tasks

1. **Route every API call through `lib/fetcher.ts`.** `app/paper/[id]/page.tsx` hardcodes `http://localhost:4000`, bypassing both the fetcher and the configured `/api/*` rewrite. Fix the `PaperResponse` type, which claims a `.pdf.url` the endpoint does not return.
2. **Fix facet encoding.** Use repeated params, not comma-joining — measured, 25 facet values in a single query contain a comma and are un-clickable, including standard forms like `Bioinformatics (Oxford, England)`. Reset `page` on any filter change.
3. **Extract a `<FacetGroup>`** from the five near-identical blocks in `FacetPanel`.
4. **Surface provenance and degradation.** Extend `ProviderCoverage` — already one of the best-judged components in the app — with provider status, and show a notice when `complete: false`.
5. **Kill the hidden search.** `RelatedPapers` costs 25.5 seconds and 2,361 fetched records to render four links. Serve related papers from the topics already on the record, or drop the section.
6. **Fix the export dialog.** "All records" and the numeric range both silently export the current page under a label promising up to 1,000.
7. **Decide on Advanced Search.** With the `Query` AST from phase 4 it can finally work. If you would rather not, remove the tab *and* the help popover — its own worked example currently makes arXiv answer HTTP 400.
8. **Decide on citations.** None of the ten formats conforms to the style it names — no author reformatting, DOIs emitted as URLs, APA and Chicago double-prefixing them. Drive them from a real CSL implementation, or cut back to BibTeX and RIS and make those two correct.
9. **Add ARIA.** Zero `aria-*` and zero `role=` across 52 `onClick` handlers. Radix covers `components/ui/`; the hand-rolled controls — the sort menu especially — are uncovered.
10. **Resolve dark mode.** A complete `.dark` token set exists and is unreachable — `darkMode` is unset in the Tailwind config and nothing applies the class. Wire it or delete the tokens.

### Done when

- [ ] No component constructs an API origin.
- [ ] Every facet value in a result set is clickable and narrows correctly.
- [ ] A degraded search visibly says so.
- [ ] Opening a paper does not trigger a search.
- [ ] Keyboard navigation works through the sort menu and result actions.

## 12 · Deploy hardening — *2–3 days*

Independent of the refactor and currently blocking any environment that is not a developer laptop. Can run in parallel with phases 4–11 if someone else picks it up.

> **Gate** — None — parallelisable from phase 03 onward.

### Tasks

1. **Rebuild `apps/api/Dockerfile`** in the image of the web one, which is already good: multi-stage, production-only install, non-root `USER`, `NODE_ENV=production`, healthcheck against `/health`. Today the API image runs as root and ships devDependencies and source.
2. **Fix the web image's API origin.** `NEXT_PUBLIC_API_BASE` is inlined at build time with no build arg, so the image is permanently pinned to localhost. Take it as an `ARG`, or move the frontend onto the relative `/api/*` rewrite so no origin needs baking in.
3. **Add the missing `web` service to `docker-compose.yml`** — there is currently no frontend in compose at all.
4. **Move off EOL Node 18** in both images, and add an `engines` field to the manifests.
5. **Add request schemas and rate limiting.** Fastify JSON schemas on both POST routes with a `pageSize` cap — a single request currently returns 9.4 MB and caches it. Stop echoing `error.message` to clients. Add `@fastify/rate-limit`.
6. **Clear the dependency backlog.** `pnpm update` resolves most of the 107 advisories; Fastify 4→5 and Next 14→15 are the two real majors and deserve their own tasks.

### Done when

- [ ] `docker-compose up` gives a working frontend and API.
- [ ] The API container runs as a non-root user and reports healthy.
- [ ] The web image can be pointed at a different API without rebuilding.
- [ ] `pnpm audit` is clean at high severity, and CI enforces it.

---

*Runbook for the provider / orchestrator / provenance refactor, originally written against commit `56817406` plus the uncommitted working tree. Phases 00 and 01 have since been executed, and this document was revised against what they found: four claims corrected, three new defects added, and every surviving measurement reproduced live — 145.5 KB of facets behind 29.7 KB of hits, a 3,079-bucket topics facet, 4,428 log lines and 31.9 seconds for one search, page one returning a single provider's records in one block.*

*Phases 00 through 07 have landed. Phase 08 is next — migrating the remaining
nine providers into the shape Europe PMC proved, each with the specific defect
fix listed against it. Line counts quoted in phases 02 and 03 were exact when
those phases ran; the tree has moved since.*

*The acceptance checkboxes under phases 02 through 06 were not ticked as those
phases landed, and have not been retro-audited item by item. The headings
record what was committed; the boxes are still worth walking before phase 10
deletes the old path on their authority.*
