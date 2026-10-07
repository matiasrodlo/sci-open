# Changelog

All notable changes to sci-open-mcp. Versions follow the rules in Step 14.4 of
docs/mcp-implementation-manual.md: a removed tool or parameter is a major
version; a renamed tool with an alias, a minor one. The tool-schema snapshots
in `test/__toolsnaps__/` are the record of every schema change.

## [Unreleased]

### Added

- `--without <sources>` (`SCI_OPEN_WITHOUT`) leaves sources out entirely: not
  searched and not asked about a paper. It is how OpenAlex's worth was
  measured before it was removed (see Removed).
- Crossref is a search source: free, with no key, and the registry of most
  journal DOIs, closed papers included. Every DOI lookup asks it, and so does
  a keyword search that wants closed papers too (verify_references' title
  searches, `open_access_only: false`); an open-access search does not, since
  it says whether a paper is open for none of its records, and coverage says
  so. Its requests, and the Crossref authority's, keep to Crossref's stated
  limits for the pool the User-Agent's contact puts them in. Measured on the
  references eval as OpenAlex's replacement: tune 122 of 128 checked and
  holdout 68 of 69 without OpenAlex, against 120 of 127 and 69 of 69 with it.
- Cited and listed DOIs are resolved from Crossref, fifty to a request:
  verify_references judges them on its record, and get_citations' and
  export_citations' rows carry its records.
- Crossref reports retractions: a work its `updated-by` names retracted,
  withdrawn or removed — the publisher's notices and Retraction Watch's data,
  which Crossref carries — is `retracted`, as Europe PMC's and PubMed's are.

- `sci-open-mcp --http` serves Streamable HTTP at `/mcp` on its own, with
  per-client request and new-search budgets, a new-search ceiling across every
  client (`SCI_OPEN_TOTAL_NEW_SEARCHES_PER_MIN`, 120), an Origin allowlist, a
  loopback Host check, `GET /health` and an admin-keyed `GET /metrics`. An
  IPv6 client is its /64, so rotating addresses within one does not buy a
  fresh budget. Settings are `SCI_OPEN_` variables; see the README.
- Every request sent to a source is counted where it leaves, by source, with
  failures, 429s and OpenAlex's own price for it (`meta.cost_usd`). Each
  result's `_meta` says what its call asked (`io.github.matiasrodlo/usage`),
  the metrics add it per tool, and `GET /metrics` and the log summary break
  the window down by source. The evals report requests and OpenAlex cost per
  case.
- A call the client cancels stops what it asked of the sources: the fan-out,
  the facet counts, the access check and the page's details, a lookup by id,
  the DOI registry, OpenAlex's DOI batches, a citation list and a full text
  (each tier's request, the wait for arXiv's crawl delay, the PDF download),
  and verify_references starts no further reference. A search or read another
  call is waiting on goes on for that call. Only parsing a PDF already
  downloaded runs to the end.
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

- A source that answers 429 is left out for a minute, not ten. Every source
  is free, and a 429 from one is a limit per second or minute; ten minutes
  was the setting for OpenAlex's daily budget, and on a references eval it
  benched Crossref for a whole list. Coverage says "rate-limited" and "a
  minute" accordingly.
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
- verify_references matched a paper cited with the wrong year to a reprint
  that carried that year: a 1982 paper cited as 1986 was called `likely`, as
  its 1986 reprint in a book series, not `ambiguous`, as the original whose
  journal, volume and first page the citation gave. A year-window match
  published somewhere other than the citation says no longer ends the search,
  and agreeing on the volume and first page cited now counts toward a match.
- verify_references called a correct citation a DOI on another paper when the
  DOI's record had left the subtitle off: OpenAlex titles "False-Positive
  Psychology: Undisclosed Flexibility…" as "False-Positive Psychology", and
  "MapReduce: simplified data processing on large clusters" as "MapReduce". A
  record titled with the cited main title alone now matches it, when the cited
  authors and year agree with the record.
- A DOI lookup read one record and checked its DOI, so a source that answered
  under another DOI and ranked first hid the record asked for: OpenAIRE
  answers an arXiv DOI with its merged preprint-and-article record under the
  journal's DOI, and DataCite's record of the arXiv DOI went unseen. It reads
  ten now.
- Crossref's records lost their subtitle: "MapReduce" for "MapReduce:
  simplified data processing on large clusters". The title now carries it.
- verify_references called a fabricated citation `ambiguous` when a real
  paper shared most of its title words, though the year and every author
  disagreed: "Quantum annealing of protein folding landscapes" (2021) and
  "Exploring quantum annealing for coarse-grained protein folding", by others.
  With the year and the authors both wrong, only the whole title cited is now
  `ambiguous`; anything less is `not_found`.
- verify_references did not find the original of a generic title, whose
  words return lookalikes and reprints ahead of it: "A mathematical theory of
  communication" cited as 1951 matched a 1950 Physics Today item, and the
  original was in no title search's answer. A match published somewhere
  other than the citation says no longer ends the plain title search, and a
  title search by the first author cited (Crossref's `query.author`) comes
  before the search of every field.
- A source's HTTP 429 reached the model as `internal`, a fault of this server:
  arXiv's, on every arXiv id while it was limiting requests, so verify_references
  left those references not checked for no stated reason. A 429 is now
  `rate_limited`, with a wait, and a 5xx `upstream_unavailable`.
- The `sci-open` CLI ignored `SCI_OPEN_ENGINE=fixture` and searched the live
  sources.
- read_paper gave an arXiv paper's `\paragraph{}` text twice: in its own
  section and again in its parent's, so a view="search" found the passage
  twice and the outline overstated the paper's length (nearly a third of 2111.11426's
  165,000 characters). A paragraph's text is now in its own section alone, and
  definitions, theorems and proofs, which only the copy in the parent carried,
  are read wherever they sit.

### Removed

- OpenAlex, which was a search source, an authority and the DOI batch. Every
  source is now free, with no key needed and no budget to run out; Crossref
  does what OpenAlex was asked for (see Added). Gone with it:
  `OPENALEX_API_KEY`; `SCI_OPEN_ALLOW_UNKEYED` and the HTTP server's refusal
  to start without a key; `openalex` in search_papers' `sources`; `openalex:`
  ids, which get_paper and the other tools now answer `not_found` saying
  OpenAlex is no longer a source; OpenAlex ids on get_citations' rows;
  whole-index topic counts (the topics facet counts the records read); and
  OpenAlex's price per request, from `_meta` (`openalex_cost_usd`), the
  metrics and the evals. Entries above that name OpenAlex describe this
  release before it was removed.
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
