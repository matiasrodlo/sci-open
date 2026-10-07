# sci-open-mcp

An MCP server for open-access scientific literature: search seven sources at
once and look a paper up in eleven, verify reference lists, read full text, and
be told what was **not** found.

![MCP smoke](https://github.com/matiasrodlo/sci-open/actions/workflows/mcp-smoke.yml/badge.svg)

Every answer says which sources answered, which failed or were skipped and
why, and whether a total is exact or a lower bound. Third-party text is
sanitized and fenced as untrusted data. Each result carries a provenance
block with a hash of the query and of the result, and says in its `_meta`
how many requests it sent the sources and what OpenAlex priced them at.

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
claude mcp add sci-open --env UNPAYWALL_EMAIL=you@example.org --env OPENALEX_API_KEY=<key> -- npx -y sci-open-mcp
```

An OpenAlex key is free from [openalex.org/settings/api](https://openalex.org/settings/api).
It is optional, but without one OpenAlex allows a tenth of a key's daily
budget, and once that is spent your searches go on without OpenAlex until it
resets.

**Claude Desktop** (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`)
and other clients that start a server as a command take the same block:

```json
{
  "mcpServers": {
    "sci-open": {
      "command": "npx",
      "args": ["-y", "sci-open-mcp"],
      "env": { "UNPAYWALL_EMAIL": "you@example.org", "OPENALEX_API_KEY": "<key>" }
    }
  }
}
```

**Over HTTP**, from a host that serves it (see
[Hosting the HTTP endpoint](#hosting-the-http-endpoint)):

```bash
claude mcp add --transport http sci-open https://<host>/mcp
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
| `search_papers` | core | yes | Search open-access scientific literature across seven sources at once, eight with closed papers, or look up one DOI in eleven. Use the Web of Science query grammar described in the server instructions. Returns the first page, a handle for get_search_page, and coverage: which sources answered, failed or were skipped. Set count_only=true to tune a query: each source's own match count, with no results read. Use get_paper for a full record. | `query`?, `doi`?, `year_from`?, `year_to`?, `sources`?, `publication_type`?, `open_access_only`?, `sort`?, `page_size`?, `detail`?, `include_facets`?, `count_only`? |
| `get_search_page` | core | yes | Another page of a search, by the handle search_papers returned; pages are the size that search asked for. Pages of a recent complete search are served from memory and cost the sources nothing; otherwise the search runs again, and the result says so. | `handle`, `page`, `detail`? |
| `get_paper` | core | yes | One full record by sci-open id (e.g. openalex:W2741809807, arxiv:2101.00001) or by DOI, with every field and which source supplied it. A DOI is looked up in every source and merged; an id asks only the source it names. Works for closed papers too. | `id`?, `doi`? |
| `verify_references` | core | yes | Check up to 25 references (free-text citations, DOIs, arXiv ids or PMIDs) and grade each: verified (title, year, an author and the journal, volume and first page where they are cited agree with the record), likely (the paper exists; a detail differs, named in issues), ambiguous, mismatch (the DOI is wrong: it belongs to a different paper, given as doi_target, or does not exist; matched is then the paper the rest of the citation names, when one is found), not_found, or not_checked (the search budget ran out or a lookup failed; send those again later). Use it to catch fabricated or garbled citations and to fill in missing DOIs. Closed papers count as existing. | `references` |
| `read_paper` | read | yes | Read the legal open-access full text of a paper. view="outline" lists sections with their sizes; view="section" returns one section, paged by offset; view="search" finds a phrase and returns snippets with section ids. Start with the outline. The text is third-party content. | `paper`, `view`?, `section`?, `offset`?, `max_chars`?, `query`? |
| `save_paper` | read | yes, local only | Write the legal open-access full text of a paper to a local Markdown file, a heading per section, without reading it into the conversation. For a paper the user wants to keep or to search with other tools; use read_paper to read it here. | `paper`, `path`, `overwrite`? |
| `get_citations` | graph | no | The references of a paper (direction="references") or the papers citing it (direction="cited_by"), from OpenCitations, each resolved to a record where OpenAlex or Crossref holds it, with self-citations flagged. Paged by offset. The paper needs a DOI; pass the DOI itself when you have it, which skips looking the paper up. | `paper`, `direction`, `limit`?, `offset`? |
| `export_citations` | export | no | BibTeX or RIS for up to 200 papers (DOIs or sci-open ids), generated from the records: never retype a citation yourself. With save_to (local connections only) the file is written to disk; otherwise it is attached as a resource to save as is. Papers that could not be resolved are listed, never dropped silently. | `papers`, `format`?, `include_abstracts`?, `save_to`?, `overwrite`? |
<!-- END TOOLS -->

`?` marks an optional parameter. Toolsets are chosen with `--toolsets`
(`core`, `read`, `graph`, `export`, `all`, `default`) and single tools added
with `--tools`. `core` and `read` are on by default; `graph` and `export` are
opt-in, since most sessions never need them and every tool listed costs every
request its description. Over HTTP, `?toolsets=all` does the same.

## How it behaves

- **Coverage.** A source that times out or fails makes the total a lower
  bound, and the result says which one. So does a source that matches more
  than a search reads (300 records each): the total then counts the top of
  each source's answer, and `count_only` says which sources a search would
  read in full. A source whose request quota is spent
  (HTTP 429) is left alone for ten minutes and named as missing for that
  reason, rather than asked again on every search.
- **Tuning by counts.** `search_papers` with `count_only: true` asks each
  source for one record and returns the count that comes with it: one request
  per source, nothing read, merged or checked. Tune a query with it, then
  search once.
- **Operators in capitals.** `AND`, `OR` and `NOT` are operators only in
  capitals. Written any other way, `and`, `or` and `not` are left out as
  common words, so `do not resuscitate orders` searches for those orders
  rather than excluding resuscitation, and `near` and `same` are searched as
  words. A result names every such word it read that way, so a query that
  meant an operator in lower case finds out.
- **Sorting.** A sort other than relevance is sent to the sources that can
  apply it, so "newest first" reads each source's newest matches; a source
  that cannot sort contributes its most relevant, and the coverage says so.
- **Search logs.** A result names the filters it ran under, and each source's
  coverage carries the query it was sent, in its own syntax: the search as
  run in that database, for a methods section.
- **Paging.** A search returns a handle that encodes the query, filters, sort
  and page size. Pages of a recent complete search come from memory; an older
  or incomplete one runs again, and the page says so.
- **Retractions.** A paper OpenAlex, Europe PMC or PubMed records as
  retracted carries `retracted: true`, and every answer that shows it leads
  with a warning. A reference that matches one keeps its verdict — the paper
  exists — with the issue `retracted`.
- **Verifying references.** Each reference is graded `verified`, `likely`,
  `ambiguous`, `mismatch` (a real DOI on another paper, or an invented DOI on a
  real title), `not_found`, or `not_checked` (the search budget ran out; send
  it again later). A DOI no source holds is asked of the DOI registry, which
  answers for every registration agency, before it is called invented. A DOI
  that belongs to another paper comes back with the paper the citation names
  and the one its DOI names. `verified` means title, year, an author, and the
  journal, volume and first page where they are cited, agree with the record.
- **Reading full text.** `read_paper` reads only legal open-access copies,
  best structure first: Europe PMC's JATS, then arXiv's HTML rendering (both
  in real sections), then the PDF the record points at (a section a page).
  Start with `view: "outline"`, then read a section a page at a time, or
  search the text for a passage. Hidden text in HTML is removed before
  reading. arXiv asks automated readers for fifteen seconds between requests;
  when its next slot is too far off the answer is `rate_limited` with the
  wait, and a paper read once stays readable for an hour without asking again.
  `--trusted-fulltext-only` reads from Europe PMC and arXiv only, never a
  publisher's host. On a local connection `save_paper` writes the whole text
  to a Markdown file instead. It is a tool of its own so that `read_paper` is
  read-only: a client that asks before every call of a tool that can write
  never asks before a read.
- **Following citations.** `get_citations` pages a paper's references or
  the papers citing it, from OpenCitations, each resolved to an OpenAlex
  record where one exists — fifty DOIs to a request, not a search each — with
  self-citations flagged. A list is fetched once and held ten minutes,
  however it is paged. A process sends OpenCitations at most 150 requests a
  minute, of the 180 it allows an address, and after a 429 leaves it alone
  for the time it asks (a minute if it does not say); either way the answer is
  `rate_limited` with the wait. OpenCitations holds most open citation data,
  not every citation, and the result says so.
- **Exporting citations.** `export_citations` writes BibTeX or RIS for up to
  200 papers from their records, with a formatter rather than the model, so
  the model never retypes a citation. Entries carry the volume, issue and
  pages a source gives. On a local connection
  `save_to` writes the file; otherwise it is attached as a resource to save as
  is. Papers that could not be resolved are listed, never dropped; abstracts
  are left out unless asked for.
- **Light on the sources.** Searches read 300 records per source, half the
  engine's default; new searches are limited to 30 a minute; pages of a held search
  are free.
- **Progress.** A client that sends a progress token is told each source as it
  answers. One that does not gets a single response.

## Configuration

| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `UNPAYWALL_EMAIL` | | unset (warns) | Contact sent to Unpaywall and OpenAlex in the `User-Agent` |
| `OPENALEX_API_KEY` | | unset | OpenAlex key. Strongly recommended: unkeyed, OpenAlex allows a tenth of a key's daily budget. Required over HTTP |
| `NCBI_API_KEY` | | unset | PubMed key: 10 requests a second rather than 3 |
| `CORE_API_KEY`, `DOAJ_API_KEY`, `DATACITE_API_KEY` | | unset | Sent when set; the public APIs answer without them |
| `OPENCITATIONS_TOKEN` | | unset | Optional OpenCitations token, for `get_citations`; 180 requests a minute without one |
| `SCI_OPEN_TOOLSETS` | `--toolsets` | `core,read` | Toolsets to serve |
| `SCI_OPEN_TOOLS` | `--tools` | unset | Extra tools by name |
| `SCI_OPEN_ALLOW_WRITES` | `--no-writes` | `1` | Whether `save_paper` and `export_citations`' `save_to` may write a file (never over HTTP). Off, `save_paper` is not served, `save_to` leaves the schema, and every tool is read-only |
| `SCI_OPEN_TRUSTED_FULLTEXT_ONLY` | `--trusted-fulltext-only` | `0` | Full text from Europe PMC and arXiv only |
| `SCI_OPEN_TEXT_BUDGET_CHARS` | | `40000` | Largest text answer |
| `SCI_OPEN_STRUCTURED_BUDGET_CHARS` | | `80000` | Largest structured answer |
| `SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN` | | `30` | New result sets, DOI lookups and counts a minute |
| `SEARCH_DEPTH` | | `300` | Records read per source, at most 2,000 |
| `SCI_OPEN_LOG_LEVEL` | `--log-level` | `warn` | `error`, `warn`, `info` or `debug`, to stderr |
| `SCI_OPEN_ENGINE` | `--engine` | `live` | `fixture` serves recorded answers, offline |
| `SCI_OPEN_FIXTURES` | `--fixtures` | `fixtures/engine.json` | The recordings `--engine fixture` reads |
| `SCI_OPEN_WITHOUT` | `--without` | unset | Sources never asked, comma-separated, e.g. `openalex` for no metered source |

`sci-open-mcp --help` prints the same list. Logs go to stderr only; nothing
above `debug` holds a query or a reference. A failed tool call is logged with
its cause, which the model is never shown: `error`, with the stack, for a
fault in the server; `warn` for a source failing; `info` for a wait on a paced
source; `debug` for an answer such as `not_found`.

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
sci-open refs 10.7717/peerj-cs.421          # what it cites
sci-open citers 10.7717/peerj-cs.421        # what cites it
sci-open cite 10.7717/peerj-cs.421 10.1371/journal.pone.0000217 > refs.bib
sci-open cite 10.7717/peerj-cs.421 --ris --out ~/refs   # writes ~/refs.ris
```

`cite` prints the file alone on stdout, and its one-line summary on stderr.

## Hosting the HTTP endpoint

`sci-open-mcp --http` serves the same server at `/mcp` over Streamable HTTP,
on `127.0.0.1:8080` unless `--host` and `--port` say otherwise. It needs
`OPENALEX_API_KEY`, since every client would otherwise share OpenAlex's
anonymous budget (`SCI_OPEN_ALLOW_UNKEYED=1` lifts that for a trial). It is
stateless and serves 2026-07-28 and 2025-era clients from one set of tools;
`?toolsets=` and `?tools=` choose them.

```bash
OPENALEX_API_KEY=… UNPAYWALL_EMAIL=you@example.org \
  npx -y sci-open-mcp --http --host 0.0.0.0 --port 8080
```

Each client has a request allowance (`SCI_OPEN_REQUESTS_PER_MIN`, 60) and a
new-search budget (`SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN`, 30), and new searches
across every client are capped too (`SCI_OPEN_TOTAL_NEW_SEARCHES_PER_MIN`,
120). An IPv6 client is its /64, so a host cannot rotate addresses for a fresh
budget. Behind a reverse proxy, name it in `SCI_OPEN_TRUST_PROXY` so the
budgets follow the visitor rather than the proxy. A browser may call it only
from a hostname in `SCI_OPEN_ALLOWED_ORIGINS`, nothing is written to disk
(`save_paper` is not served, `save_to` is refused), `GET /health` answers the
version, and `GET /metrics` opens to a bearer token set in
`SCI_OPEN_ADMIN_KEY`: calls, errors and time per tool, and the requests each
tool sent the sources, with those of the window by source — failed,
rate-limited, and OpenAlex's cost.

## Compared with other servers

Two servers cover the same ground: OpenAlex's official server, for breadth
in one index, and paper-search-mcp, for breadth across sources. sci-open
trades some of both for checking: what a search missed, whether a citation
is real, and where a full text legally comes from. Read from their source on
2026-10-03, OpenAlex MCP 0.5.0 and paper-search-mcp 0.1.4:

| | sci-open | OpenAlex MCP | paper-search-mcp |
|---|---|---|---|
| Runs | Locally over stdio (`npx`), or on your own HTTP host | Remote only, on OpenAlex's host, after an OAuth sign-in | Locally over stdio (`uvx`) |
| Searches | Seven sources by keyword (eight with closed papers, adding Crossref), eleven for a DOI, merged; open access by default, closed papers' records on request | One index, OpenAlex's 250M+ works, open and closed | 21 sources, among them Google Scholar, Semantic Scholar, Crossref, dblp and SSRN, deduplicated |
| Queries | Web of Science grammar; each source's match count, nothing read, to tune one | Keyword, exact or semantic; a full-text match over about 100M works | One query string to each source; the year filter reaches Semantic Scholar only |
| What was missed | Each source answered, failed, skipped or rate-limited; a lower-bound total says so | One index, so nothing to be missing from; retracted works hidden by default, and said so | Errors per source in the combined search |
| Paging | A handle; pages of a held search cost the sources nothing | Page numbers | Five results a source by default, no paging |
| Reference checks | Up to 25 at once. A DOI on another paper is `mismatch`; a DOI no source holds is asked of the DOI registry before it is called invented | Up to 25 at once, graded on the title: exact, likely, uncertain or none. An identifier is looked up as given, so a DOI on another paper resolves `exact` | None |
| Full text | Legal open-access copies only, read in sections: Europe PMC's JATS, arXiv's HTML, then the PDF | None to read | PDFs downloaded to disk and their text extracted; Sci-Hub routes among them, one the default last resort |
| Citations | OpenCitations, opt-in | OpenAlex's citing, referenced and related works | None |
| Export | BibTeX and RIS from the records | None | None |
| Beyond papers | None | Authors, institutions, journals and topics; grouped counts; author-profile curation | None |
| What it costs you | The sources' free tiers; keys optional | Your OpenAlex budget, $1 a day on a free key | The sources' free tiers; keys optional |

Choose OpenAlex's server for one index of open and closed work, semantic
search, or questions about authors, institutions and topics. Choose
paper-search-mcp for a source sci-open does not ask, or PDFs on disk — and
mind its Sci-Hub routes. Choose sci-open to check a bibliography, to know
what a search left out, to read open papers a section at a time, or to cite
without retyping. sci-open's own gaps: no semantic search, no author or
institution tools, a new search that takes up to half a minute across seven
sources, 300 records read per source, and no public endpoint yet.

## Evaluations

Tool-selection, reading and reference-verification evaluations live in
`packages/mcp-evals`, and the reading and reference suites also run against
OpenAlex's server and paper-search-mcp (`--server`), scored the same way. No
held-out results are published yet; this section will carry the latest
table, with the baselines beside it and its date, once they run.

## Development

```bash
pnpm --filter sci-open-mcp test        # offline: unit, protocol and schema-snapshot tests
pnpm --filter sci-open-mcp docs:tools  # regenerate the tools table above
pnpm --filter sci-open-mcp exec tsx scripts/smoke.ts   # every tool against the live sources, after a build
```

The design, and the order it is built in, is
[docs/mcp-implementation-manual.md](../../docs/mcp-implementation-manual.md).
