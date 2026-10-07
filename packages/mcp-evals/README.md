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
| Reading | `pnpm --filter mcp-evals eval:reading [tune\|holdout]` | Claude API credentials and the network; costs API credit | Whether Claude, reading through `read_paper`, answers a question only the paper's full text answers: the last `Answer:` line, matched exactly against accepted forms |

Build the server first (`pnpm build --filter=sci-open-mcp`); the harness
starts its stdio binary as a client would.

The references suite asks the live sources for every reference — up to three
searches each — and counts against their rate limits like any other search.
Every source is free, so a run costs nothing, but run it deliberately, not in
a loop: a holdout run is 70 references, up to 210 searches, and a tune run
130, and arXiv and Crossref answer 429 to a process that asks too fast.

## Through Claude Code

`--client claude-code` runs the model turns through Claude Code (`claude -p`)
on the signed-in Claude account instead of the Claude API, for anyone without
an API key. It works with every suite that calls a model:

```bash
pnpm --filter mcp-evals eval:selection tune --client claude-code
```

It needs the `claude` CLI on the PATH and signed in (`claude`, then
`/login`). Each case runs in an empty directory with the same model and turn
limit. Only the server's tools are offered, with Claude Code's built-in tools,
every other MCP server and the user's settings left out. Claude Code's own
system prompt and effort still apply, so its numbers measure the tools as a
Claude Code user meets them. They are not comparable with the API runs, and
their reports carry `claude-code` in the file name. Each case counts against
the account's usage limits.

## Without a source

`--without <sources>` runs the references or reading suite against sci-open
with those sources left out (`SCI_OPEN_WITHOUT`), and names the report after
them (`2026-10-07-references-holdout-without-crossref.md`). Run beside the
same suite with every source, it measures what a source is worth. It is how
OpenAlex was measured before it was removed, on 2026-10-07:

```bash
pnpm --filter mcp-evals eval:references holdout --without crossref
```

## Baselines

`--server <name>` runs the references or reading suite against another MCP
server instead, scored by the same scorers, and writes its report under a
file name that carries the server's name. pnpm passes the flag through, with
or without a `--` before it:

```bash
pnpm --filter mcp-evals eval:references holdout --server openalex
pnpm --filter mcp-evals eval:reading holdout --server paper-search
```

| Server | How the harness reaches it | Needs |
|---|---|---|
| `openalex` | The official OpenAlex server, remote only: Streamable HTTP at `https://mcp.openalex.org/mcp`, or `OPENALEX_MCP_URL` | `OPENALEX_MCP_TOKEN`: an access token from its OAuth sign-in. Every call spends the signed-in account's OpenAlex budget |
| `paper-search` | paper-search-mcp 0.1.4 from PyPI, over stdio through `uvx`, in a temporary directory | `uv`. It reads the same `UNPAYWALL_EMAIL`, `CORE_API_KEY` and `DOAJ_API_KEY` as sci-open, so both run with the keys they share; 0.1.4 takes no OpenAlex key |

For the OpenAlex token: the server's repository
(`ourresearch/openalex-mcp-server`) has `scripts/oauth-login.ts`, which runs
its OAuth flow without a browser, your own OpenAlex API key standing in for
the consent click; any MCP client that has signed in holds one too.

The references suite calls a server's own checker when it has one, with no
model: `verify_references` for sci-open, `resolve_references` for OpenAlex,
whose match levels count as verdicts — `exact` as `verified`, `likely` as
`likely`, `uncertain` as `ambiguous`, `none` as `not_found`. It has no verdict
for a DOI that names the wrong paper, so such a reference counts as
`verified`, and against it. A server without a checker (paper-search) has
Claude check each list with its tools and end with one `Verdict <n>:` line a
reference; `--via-model` does the same for any server, sci-open included,
which is the like-for-like comparison. A reference the model gave no verdict
for is scored wrong. Model runs cost API credit, and report tool calls and
tokens per list. Against sci-open, every suite also reports the requests its
calls sent the sources, read from each result's `_meta`.

The selection suite is sci-open's alone: it scores sci-open's tool names.

The harness never offers a model paper-search's Sci-Hub routes
(`download_scihub`, and `download_with_fallback`, which falls back to it
unless told not to),
and cuts any tool result at 100,000 characters, as a client cuts one over
25,000 tokens; sci-open's own budget keeps its results far below that.

## Datasets

- `datasets/tool-selection.jsonl`: one prompt per line, with the tool expected
  first (`first`) or in order (`sequence`), and arguments that must match
  (`args`; an array is compared as a set), and the toolsets to serve
  (`toolsets`, the default ones when absent: `get_citations` and
  `export_citations` are opt-in). Cases that need a tool a release does not
  ship stay out until it ships.
- `datasets/references/*.json`: twenty lists of ten real references with
  errors planted and labelled: `none`, `closed_real`, `preprint_version` (all
  real — flagging them is the error that hurts most), `fabricated`,
  `doi_wrong`, `doi_invented`, `year_wrong` and `author_wrong`. `accept` is
  the verdicts that count as right. Every real record was checked against
  Crossref or DataCite, and every invented DOI against doi.org, when the list
  was written. Thirteen lists are `tune` (130 references), seven `holdout`
  (70). `refs-07` to `refs-20` are each one field's bibliography in one
  citation style (Vancouver, APA, Nature, IEEE or Chicago), their citations
  written from the records' metadata, their `closed_real` papers checked
  closed in OpenAlex, and no paper in two lists. `refs-01` to `refs-06` are
  machine learning, laboratory methods, statistics and medicine in Vancouver
  style; a paper may recur among their tune lists. No holdout paper appears
  in a tune list or among the reference parser's test cases
  (`packages/mcp/test/fixtures/references.json`): add a parser case from a
  tune list, never from a holdout one.

- `datasets/reading.jsonl`: twenty questions about open-access papers in
  Europe PMC, each answered by a sentence in a methods or results section,
  with the accepted forms of a short answer. Every answer was checked against
  the paper's full text when the question was written; two of them (`rd-14`,
  `rd-15`) also appear in the abstract.

Every case carries `split: "tune" | "holdout"`. Change descriptions and
thresholds against `tune` only; `holdout` is the number that gets published.

## Results

Each run writes `results/<date>-<suite>-<split>.json` (every case) and `.md`
(the table); a baseline's carry its name, and `-model` when Claude did the
checking (`2026-10-03-references-holdout-openalex.md`). Commit the ones that are published, with the commit they were
measured on.
