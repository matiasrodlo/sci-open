# Changelog

All notable changes to sci-open-mcp. Versions follow the rules in Step 14.4 of
docs/mcp-implementation-manual.md: a removed tool or parameter is a major
version; a renamed tool with an alias, a minor one. The tool-schema snapshots
in `test/__toolsnaps__/` are the record of every schema change.

## [Unreleased]

### Added

- `sci-open-mcp --http` serves Streamable HTTP at `/mcp` on its own, with
  per-client request and new-search budgets, an Origin allowlist, a loopback
  Host check, `GET /health` and an admin-keyed `GET /metrics`. Settings are
  `SCI_OPEN_` variables; see the README.
- A failed tool call is logged on stderr with its cause, which the model is
  still never shown: an `error`, with the stack, for a fault in the server, a
  warning for a source failing, `info` for a wait on a paced source and
  `debug` for an answer such as `not_found`. A reference verify_references
  could not check, or a paper export_citations could not resolve, is logged
  the same way, though its call succeeds.
- `server.json` and the plugin declare `OPENALEX_API_KEY` and `NCBI_API_KEY`,
  so an installer driven by the registry asks for them.

### Changed

- A paper looked up by id is held half an hour, so read_paper and
  get_citations, given an id, stop asking its source again before every
  outline, section and page. Two lookups of one id at once ask once.

### Fixed

- A DOI written `doi:10.…` — as get_citations and verify_references print
  one, and as citations write it — was taken for a sci-open id, and
  get_paper, read_paper, get_citations and export_citations answered a real
  paper with `not_found`. Every tool now reads a DOI by the engine's own
  rule: bare, as a doi.org URL or after `doi:`, search_papers' query
  included. `arXiv:…` and `PMID: …` are read as the ids `arxiv:…` and
  `ncbi:…`.
- search_papers refuses a `doi` that is not a DOI, rather than searching for
  its words and listing what it found under that DOI.

### Removed

- The sci-open web app and API, and with them `/api/mcp`,
  `MCP_HTTP_ENABLED` and `MCP_ALLOWED_ORIGINS`. The repository is the MCP
  server and the engine it is built on; `--http` replaces the API route.

## [0.4.0] - unreleased

Set the date in the commit that tags `mcp-v0.4.0`.

### Added

- get_citations, opt-in (toolset `graph`): a paper's references or the
  papers citing it, from OpenCitations, each resolved to an OpenAlex record
  where one exists, with self-citations flagged, paged by offset. A list is
  fetched once and held ten minutes. At most 150 requests a minute go to
  OpenCitations, and a 429 leaves it alone for the time it asks, the
  citation-count authority included. `OPENCITATIONS_TOKEN` raises its limit.
- export_citations, opt-in (toolset `export`): BibTeX or RIS for up to 200
  papers, from the records and with the formatter the web app uses. `save_to`
  writes the file on a local connection; otherwise it is attached as an
  embedded resource. Unresolved papers are listed; abstracts are opt-in.
- `sci-open refs`, `sci-open citers` and `sci-open cite`.
- Retractions. A paper OpenAlex, Europe PMC or PubMed records as retracted
  carries `retracted: true` first in its record, and every tool that shows it
  leads with a warning. verify_references keeps the verdict, since the paper
  exists, adds the issue `retracted`, and counts them in its summary.
- The plugin serves every toolset, and both skills export with
  export_citations; systematic-search also follows citations.

### Changed

- The instructions describe get_citations and export_citations only to a
  client that is served them.

## [0.3.0] - unreleased

Set the date in the commit that tags `mcp-v0.3.0`.

### Added

- The server over Streamable HTTP, at `/api/mcp` on the sci-open API:
  stateless, for 2026-07-28 and 2025-era clients alike, with progress as an
  SSE stream for a client that asks for it. Off unless `MCP_HTTP_ENABLED=true`,
  and then only with an OpenAlex key. Searches over it read 300 records per
  source (`MCP_SEARCH_DEPTH`) and spend the same per-visitor new-search budget
  as the web app; a browser may call it only from `MCP_ALLOWED_ORIGINS`;
  `save_to` is always refused. `?toolsets=` and `?tools=` choose the tools,
  and an unknown name answers 400 with the valid ones.
- `createHttpHandler`, the same server as a web-standard request handler.
- A Claude Code plugin, installable from this repository's marketplace: the
  server and two skills, `verify-bibliography` and `systematic-search`.

### Changed

- read_paper refuses `save_to` on a connection that cannot write before
  fetching anything. It used to look the paper up and download its text first.

## [0.2.0] - unreleased

Set the date in the commit that tags `mcp-v0.2.0`.

### Added

- read_paper, on by default: the legal open-access full text of a paper as an
  outline, a section a page at a time, or a search for a passage, from Europe
  PMC's JATS, arXiv's HTML rendering or the PDF, in that order. `save_to`
  writes it to a Markdown file on a local connection.
- `--trusted-fulltext-only`: full text from Europe PMC and arXiv only.
- `sci-open read`.

### Changed

- read_paper can write a file, so it is annotated as not read-only and as
  destructive (it replaces a file only with `overwrite: true`).

## [0.1.0] - unreleased

Set the date in the commit that tags `mcp-v0.1.0`.

### Added

- search_papers (with count_only), get_search_page, get_paper and
  verify_references, on by default, over stdio.
- Coverage on every search: which sources answered, failed, were skipped or
  were left out for a spent request quota, and whether the total is a lower
  bound.
- Progress notifications while a search runs, for clients that ask for them.
- A provenance block on every result, with hashes of the query and the result.
- `--engine fixture`, which serves recorded answers offline.
- The `sci-open` command line, calling the same tools.
