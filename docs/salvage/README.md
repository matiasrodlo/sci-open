# Salvage

Code rescued from `apps/api/src/lib/search-pipeline.ts` before that file's
deletion was committed. The file was replaced by `enhanced-search-pipeline.ts`,
but the rewrite dropped two capabilities that the refactor plans to restore.
Nothing here is compiled or imported — `docs/` sits outside every tsconfig
`include`. These are reference copies, kept so the logic does not have to be
recovered from history months from now.

| File | What it was | Wanted again in |
|---|---|---|
| `ranking.ts` | `mixResultsBySource`, `calculateRelevanceScore` | Phase 6 — the orchestrator's rank step |
| `enrichment.ts` | `mergeCrossrefData`, `mergeUnpaywallData` | Phase 9 — authorities and enrichment |

## Recovering the full original

The deletion was staged but not committed at the time of salvage, so the whole
1,275-line file is one command away:

```
git show 56817406:apps/api/src/lib/search-pipeline.ts
```

`56817406` is the last commit that contains it on `main`. An earlier audit cited
`c9fd98c4` — that commit is **not reachable from `main`** (it belongs to a
pre-rebase line that was duplicated onto `main` as `574c295d`) and could be
pruned by `git gc`. Use the hash above.

## Caveats carried over

Both files reproduce the original behaviour, defects included. The per-file
headers spell out what to fix on the way back in — chiefly that
`mixResultsBySource` groups rather than mixes, and that
`calculateRelevanceScore` never reads the query.
