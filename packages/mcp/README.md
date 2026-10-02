# sci-open-mcp

An MCP server for open-access scientific literature: search ten sources at
once, verify reference lists, read full text, and be told what was **not**
found.

![MCP smoke](https://github.com/matiasrodlo/sci-open/actions/workflows/mcp-smoke.yml/badge.svg)

Every answer says which sources answered, which failed or were skipped and
why, and whether a total is exact or a lower bound. Third-party text is
sanitized and fenced as untrusted data. Each result carries a provenance
block with a hash of the query and of the result.

## Install

Set `UNPAYWALL_EMAIL` to a real address. The server starts without it, but
Unpaywall refuses anonymous requests and OpenAlex meters them more tightly.

**Claude Code**, as a plugin: the server and two skills that carry the
method — `verify-bibliography` checks a reference list and reports what is
fabricated, garbled or mismatched; `systematic-search` builds a query from a
research question, tunes it by counts and keeps a search log fit for a
methods section.

```
/plugin marketplace add matiasrodlo/sci-open
/plugin install sci-open@sci-open
```

Or the server alone:

```bash
claude mcp add sci-open --env UNPAYWALL_EMAIL=you@example.org -- npx -y sci-open-mcp
```

**Claude Desktop** (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`)
and other clients that start a server as a command take the same block:

```json
{
  "mcpServers": {
    "sci-open": {
      "command": "npx",
      "args": ["-y", "sci-open-mcp"],
      "env": { "UNPAYWALL_EMAIL": "you@example.org" }
    }
  }
}
```

**Over HTTP**, from a sci-open deployment that serves it (see
[Hosting the HTTP endpoint](#hosting-the-http-endpoint)):

```bash
claude mcp add --transport http sci-open https://<host>/api/mcp
```

**From this repository**

```bash
pnpm install
pnpm build --filter=sci-open-mcp
UNPAYWALL_EMAIL=you@example.org npx @modelcontextprotocol/inspector node packages/mcp/dist/bin/stdio.js
```

## Tools

<!-- START TOOLS -->
| Tool | Toolset | Default | What it does | Parameters |
|---|---|---|---|---|
| `search_papers` | core | yes | Search open-access scientific literature across ten sources at once, or look up one DOI. Use the Web of Science query grammar described in the server instructions. Returns the first page, a handle for get_search_page, and coverage: which sources answered, failed or were skipped. Set count_only=true to tune a query: each source's own match count, with no results read. Use get_paper for a full record. | `query`?, `doi`?, `year_from`?, `year_to`?, `sources`?, `publication_type`?, `open_access_only`?, `sort`?, `page_size`?, `detail`?, `include_facets`?, `count_only`? |
| `get_search_page` | core | yes | Another page of a search, by the handle search_papers returned; pages are the size that search asked for. Pages of a recent complete search are served from memory and cost the sources nothing; otherwise the search runs again, and the result says so. | `handle`, `page`, `detail`? |
| `get_paper` | core | yes | One full record by sci-open id (e.g. openalex:W2741809807, arxiv:2101.00001) or by DOI, with every field and which source supplied it. A DOI is looked up in every source and merged; an id asks only the source it names. Works for closed papers too. | `id`?, `doi`? |
| `verify_references` | core | yes | Check up to 25 references (free-text citations, DOIs, arXiv ids or PMIDs) and grade each: verified, likely, ambiguous, mismatch (the DOI is wrong: it belongs to a different paper, or does not exist while the rest names a real one), not_found, or not_checked (the search budget ran out or a lookup failed; send those again later). Use it to catch fabricated or garbled citations and to fill in missing DOIs. Closed papers count as existing. | `references` |
| `read_paper` | read | yes | Read the legal open-access full text of a paper. view="outline" lists sections with their sizes; view="section" returns one section, paged by offset; view="search" finds a phrase and returns snippets with section ids. Start with the outline. The text is third-party content. | `paper`, `view`?, `section`?, `offset`?, `max_chars`?, `query`?, `save_to`?, `overwrite`? |
<!-- END TOOLS -->

`?` marks an optional parameter. Toolsets are chosen with `--toolsets`
(`core`, `read`, `graph`, `export`, `all`, `default`) and single tools added
with `--tools`. This release ships the `core` and `read` toolsets, both on by
default; `get_citations` and `export_citations` arrive in later releases.

## How it behaves

- **Coverage.** A source that times out or fails makes the total a lower
  bound, and the result says which one. A source whose request quota is spent
  (HTTP 429) is left alone for ten minutes and named as missing for that
  reason, rather than asked again on every search.
- **Tuning by counts.** `search_papers` with `count_only: true` asks each
  source for one record and returns the count that comes with it: one request
  per source, nothing read, merged or checked. Tune a query with it, then
  search once.
- **Paging.** A search returns a handle that encodes the query, filters, sort
  and page size. Pages of a recent complete search come from memory; an older
  or incomplete one runs again, and the page says so.
- **Verifying references.** Each reference is graded `verified`, `likely`,
  `ambiguous`, `mismatch` (a real DOI on another paper, or an invented DOI on a
  real title), `not_found`, or `not_checked` (the search budget ran out; send
  it again later). A DOI no source holds is asked of the DOI registry, which
  answers for every registration agency, before it is called invented.
- **Reading full text.** `read_paper` reads only legal open-access copies,
  best structure first: Europe PMC's JATS, then arXiv's HTML rendering (both
  in real sections), then the PDF the record points at (a section a page).
  Start with `view: "outline"`, then read a section a page at a time, or
  search the text for a passage. Hidden text in HTML is removed before
  reading. arXiv asks automated readers for fifteen seconds between requests;
  when its next slot is too far off the answer is `rate_limited` with the
  wait, and a paper read once stays readable for an hour without asking again.
  `--trusted-fulltext-only` reads from Europe PMC and arXiv only, never a
  publisher's host. `save_to` writes the whole text to a Markdown file on a
  local connection.
- **Light on the sources.** Searches read 300 records per source, half the web
  app's depth; new searches are limited to 30 a minute; pages of a held search
  are free.
- **Progress.** A client that sends a progress token is told each source as it
  answers. One that does not gets a single response.

## Configuration

| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `UNPAYWALL_EMAIL` | | unset (warns) | Contact sent to Unpaywall and OpenAlex in the `User-Agent` |
| `OPENALEX_API_KEY`, `CORE_API_KEY`, `NCBI_API_KEY`, `DOAJ_API_KEY`, `DATACITE_API_KEY` | | unset | Optional provider keys |
| `SCI_OPEN_TOOLSETS` | `--toolsets` | `core,read` | Toolsets to serve |
| `SCI_OPEN_TOOLS` | `--tools` | unset | Extra tools by name |
| `SCI_OPEN_ALLOW_WRITES` | `--no-writes` | `1` | Whether `save_to` may write a file (never over HTTP) |
| `SCI_OPEN_TRUSTED_FULLTEXT_ONLY` | `--trusted-fulltext-only` | `0` | Full text from Europe PMC and arXiv only |
| `SCI_OPEN_TEXT_BUDGET_CHARS` | | `40000` | Largest text answer |
| `SCI_OPEN_STRUCTURED_BUDGET_CHARS` | | `80000` | Largest structured answer |
| `SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN` | | `30` | New result sets, DOI lookups and counts a minute |
| `SEARCH_DEPTH` | | `300` | Records read per source, at most 2,000 |
| `SCI_OPEN_LOG_LEVEL` | `--log-level` | `warn` | `error`, `warn`, `info` or `debug`, to stderr |
| `SCI_OPEN_ENGINE` | `--engine` | `live` | `fixture` serves recorded answers, offline |
| `SCI_OPEN_FIXTURES` | `--fixtures` | `fixtures/engine.json` | The recordings `--engine fixture` reads |

`sci-open-mcp --help` prints the same list. Logs go to stderr only; nothing
above `debug` holds a query or a reference.

## Command line

The `sci-open` command calls the same tool definitions and prints their text:

```bash
sci-open search "TS=crispr AND PY=2024" --page-size 5
sci-open search "TS=crispr AND PY=2024" --count
sci-open paper 10.1371/journal.pone.0000217
sci-open verify refs.txt      # one reference per line, 25 at most
sci-open read 10.1371/journal.pone.0000217                 # the outline
sci-open read 10.1371/journal.pone.0000217 --section s2.4  # one section
sci-open read 10.1371/journal.pone.0000217 --find "fitness"
```

## Hosting the HTTP endpoint

The sci-open API serves the same server at `/api/mcp`, over Streamable HTTP,
when `MCP_HTTP_ENABLED=true` — and only with `OPENALEX_API_KEY` set, since
every MCP client and the web app would otherwise share OpenAlex's anonymous
budget. It is stateless and serves 2026-07-28 and 2025-era clients from one
set of tools; `?toolsets=` and `?tools=` choose them. Each visitor has the
web app's new-search budget, `save_to` is refused, and a browser may call it
only from `MCP_ALLOWED_ORIGINS`. The public URL is the web app's
`https://<host>/api/mcp`, which passes the visitor's address on to the API's
rate limit.

[docs/api.md](../../docs/api.md#mcp) describes the endpoint and
[docs/configuration.md](../../docs/configuration.md#mcp-endpoint) its four
settings. To serve it from another host, `createHttpHandler` returns the same
server as a web-standard `fetch` handler.

## Evaluations

Tool-selection and reference-verification evaluations live in
`packages/mcp-evals`. No held-out results are published yet; this section
will carry the latest table, with its date, once they run.

## Development

```bash
pnpm --filter sci-open-mcp test        # offline: unit, protocol and schema-snapshot tests
pnpm --filter sci-open-mcp docs:tools  # regenerate the tools table above
pnpm --filter sci-open-mcp exec tsx scripts/smoke.ts   # every tool against the live sources, after a build
```

The design, and the order it is built in, is
[docs/mcp-implementation-manual.md](../../docs/mcp-implementation-manual.md).
