# mcp-evals

Evaluations of the sci-open MCP server (`packages/mcp`). Tests prove the code
does what it says; these measure whether it is useful: does a model choose
the right tool, and does `verify_references` grade references right?

Nothing here runs under `pnpm test`, which never spends API credit or needs
the network.

## Suites

| Suite | Command | Needs | Measures |
|---|---|---|---|
| Tool selection | `pnpm --filter mcp-evals eval:selection [tune\|holdout]` | Claude API credentials (`ANTHROPIC_API_KEY` or `ant auth login`); costs API credit | Whether Claude Opus 5.5 calls the expected tool first, with the expected arguments, against the fixture engine — the server answers the same every run, so only the model varies |
| References | `pnpm --filter mcp-evals eval:references [tune\|holdout]` | `UNPAYWALL_EMAIL`, the network; no model | Recall per planted error type, precision of the flags, and the rate at which real papers are called fabricated |

Build the server first (`pnpm build --filter=sci-open-mcp`); the harness
starts its stdio binary as a client would.

The references suite asks the live sources for every reference — up to three
searches each — and is billed against their quotas like any other search, the
OpenAlex key's daily budget included. Run it deliberately, not in a loop.

## Datasets

- `datasets/tool-selection.jsonl`: one prompt per line, with the tool expected
  first (`first`) or in order (`sequence`), and arguments that must match
  (`args`; an array is compared as a set). Cases that need a tool this release
  does not ship stay out until it ships — `ts-03` waits for `read_paper`.
- `datasets/references/*.json`: lists of real references with errors planted
  and labelled: `none`, `closed_real`, `preprint_version` (all real — flagging
  them is the error that hurts most), `fabricated`, `doi_wrong`,
  `doi_invented`, `year_wrong` and `author_wrong`. `accept` is the verdicts
  that count as right. Every real record was checked against Crossref or
  DataCite, and every invented DOI against doi.org, when the list was written.

Every case carries `split: "tune" | "holdout"`. Change descriptions and
thresholds against `tune` only; `holdout` is the number that gets published.

## Results

Each run writes `results/<date>-<suite>-<split>.json` (every case) and `.md`
(the table). Commit the ones that are published, with the commit they were
measured on.
