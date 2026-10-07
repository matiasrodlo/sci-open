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
- Every request sent to a source is counted where it leaves, by source, with
  failures, 429s and OpenAlex's own price for it (`meta.cost_usd`). Each
  result's `_meta` says what its call asked (`io.github.matiasrodlo/usage`),
  the metrics add it per tool, and `GET /metrics` and the log summary break
  the window down by source. The evals report requests and OpenAlex cost per
  case.
- A call the client cancels stops what it asked of the sources: the fan-out,
  the facet counts, the access check and the page's details, and
  verify_references starts no further reference. A search another call is
  waiting on goes on for that call. A full text or citation list being
  fetched still runs to the end.
- A failed tool call is logged on stderr with its cause, which the model is
  still never shown: an `error`, with the stack, for a fault in the server, a
  warning for a source failing, `info` for a wait on a paced source and
  `debug` for an answer such as `not_found`. A reference verify_references
  could not check, or a paper export_citations could not resolve, is logged
  the same way, though its call succeeds.
- `server.json` and the plugin declare `OPENALEX_API_KEY` and `NCBI_API_KEY`,
  so an installer driven by the registry asks for them.
- What each source was sent — its native query, the search as run there — is
  in coverage's `per_source[].query` and the provenance block, and count_only
  lists it under "Sent to each source". A search page and a count open with a
  "Filters:" line. The systematic-search skill logs both, and agrees the scope
  (open access only or not, years, publication type) before searching.
- A paper carries its volume, issue and pages (`biblio`), from OpenAlex,
  Crossref, Europe PMC, PubMed and DOAJ. export_citations writes them (BibTeX
  `volume`, `number`, `pages`; RIS `VL`, `IS`, `SP`, `EP`), get_paper and
  `detail: "full"` show them, and verify_references checks a cited volume and
  first page against them.
- `save_paper` (toolset `read`) writes a paper's whole full text to a local
  Markdown file, none of it into the conversation. It replaces read_paper's
  `save_to`, so read_paper is read-only: a client that asks before every call
  of a tool that can write no longer asks before every outline and section.
  It is served only where writes are allowed; over HTTP, or with
  `--no-writes`, it is left out, and asking for it by name is refused.

### Changed

- Query operators are capitals only. `and`, `or` and `not` written any other
  way are left out of the search as common words, and `near` and `same` are
  searched as words. In any case, the English in a query was read as logic:
  `do not resuscitate orders` was sent to Europe PMC and PubMed as
  `do AND NOT resuscitate AND orders`, the opposite of what was asked, and
  `near infrared spectroscopy` was refused as a proximity search. A result
  names every such word it read that way (`query.read_as_words`, and a
  "Read as words" line), so a query that meant an operator in lower case
  finds out. `NEAR/3` is still refused in any case.
- Where writes are not allowed — over HTTP, or with `--no-writes` —
  export_citations offers no `save_to` or `overwrite` and is annotated
  read-only, a `save_to` sent anyway is answered `writes_disabled`, and
  save_paper is not served. On a local connection with writes allowed
  nothing changes.
- The text the model reads carries what the workflows need: search_papers
  shows the facets it was asked for, not only in structured content;
  `detail: "full"` shows each result's abstract, DOI, venue and citation count,
  for screening without a get_paper each, while `concise` stays a table; and
  get_paper adds the citation count, publisher, topics, landing page and
  full-text link. The systematic-search skill screens with `detail: "full"`.
- search_papers counts facets across the sources only with
  `include_facets`. Every plain search used to count them — five OpenAlex
  `group_by` requests, and a request a year for ten years to each source that
  reports only a total — for numbers the default output never showed, and a
  count a rate limit cut short held the set a minute instead of half an hour.
  The handle records the choice, so a search's pages come from its own set.
- verify_references reads 25 records a source for a title search, not 300.
  It judges the top five of the merged answer, which rank fusion builds from
  the top of each source; the rest cost OpenAlex, DOAJ and OpenAIRE extra
  pages that nobody judged.
- verify_references asks OpenAlex for every cited DOI at once, fifty to a
  request, and looks a DOI up in every source — a search, spending an
  admission — only when OpenAlex lacks it. A batch of 25 references with
  DOIs used to be 25 searches of ten sources and most of a minute's
  admissions. Verdicts are unchanged; such a match is corroborated by
  OpenAlex alone, and whether it is retracted is OpenAlex's word.
- A sort other than relevance is sent to every source that can read in that
  order (OpenAlex either way by date and citations; Europe PMC and OpenAIRE
  newest and most cited first; PubMed newest first; arXiv and PLOS by date),
  and coverage says which sources sorted and which read by relevance. It used
  to reorder the top 300 each source returned by relevance.
- Ranking counts the best source's position in full and each further one at
  half the weight, rather than a point for every index that holds a paper; a
  title that is the query ranks first; corrections, errata, retraction
  notices and replies are moved down.
- publication_type `peer-reviewed` takes in review articles (OpenAlex's
  `review` type) and closed MEDLINE articles, and leaves out dissertations,
  reports and notices (editorials, letters, errata, retraction notices) in
  OpenAlex, PubMed, Europe PMC and Crossref. PubMed's stage comes from its
  publication types, not from whether PMC holds a copy.
- verify_references: a `mismatch` for a DOI that belongs to another paper
  gives the paper the citation names as `matched`, and the DOI's own paper as
  `doi_target`; `cited_title_not_found` says when there is none. A journal,
  volume or first page that differs from the record's makes a citation
  `likely`, with `venue_mismatch`, `volume_mismatch` or `pages_mismatch`.
- arXiv records without a published version carry their arXiv DOI
  (`10.48550/arXiv.<id>`), so they merge with OpenAlex's and Europe PMC's
  copies and have citations to follow and export.
- PubMed names are written "Surname, Forename"; BibTeX titles brace words a
  style must not lower-case (CRISPR, mRNA); group authors are braced whole.
- The server says a search asks seven sources and a DOI lookup ten.
- read_paper says when it reads the arXiv preprint of a published paper, or
  a repository copy that may be the accepted manuscript.
- A paper looked up by id is held half an hour, so read_paper and
  get_citations, given an id, stop asking its source again before every
  outline, section and page. Two lookups of one id at once ask once.

### Fixed

- A bad argument is answered in the server's own form, `Error (invalid_input)`
  with what is wrong and a hint, and counted in the metrics; the SDK used to
  answer it in words of its own, uncounted. A parameter a tool does not take
  is refused, naming it, rather than dropped (`pagesize: 5` ran a page of
  ten), and every tool's schema says so (`additionalProperties: false`).
- A DOI written `doi:10.…` — as get_citations and verify_references print
  one, and as citations write it — was taken for a sci-open id, and
  get_paper, read_paper, get_citations and export_citations answered a real
  paper with `not_found`. Every tool now reads a DOI by the engine's own
  rule: bare, as a doi.org URL or after `doi:`, search_papers' query
  included. `arXiv:…` and `PMID: …` are read as the ids `arxiv:…` and
  `ncbi:…`.
- search_papers refuses a `doi` that is not a DOI, rather than searching for
  its words and listing what it found under that DOI.
- A search's total counted the top 300 read from each source and was shown as
  exact when every source answered, with "End of results" on its last page.
  A source that matches more than a search reads is now listed in
  `coverage.truncated`, makes `total_is_lower_bound` true and the heading's
  total a floor, and the last page says "End of what was read". count_only
  says whether a search would read each source in full.
- verify_references took a cited surname for an author's when it was part of
  any author's name: "Li" verified as Illia Polosukhin.
- The `sci-open` CLI ignored `SCI_OPEN_ENGINE=fixture` and searched the live
  sources.

### Removed

- read_paper's `save_to` and `overwrite`: use save_paper.
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
