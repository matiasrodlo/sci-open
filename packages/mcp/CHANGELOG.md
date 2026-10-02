# Changelog

All notable changes to sci-open-mcp. Versions follow the rules in Step 14.4 of
docs/mcp-implementation-manual.md: a removed tool or parameter is a major
version; a renamed tool with an alias, a minor one. The tool-schema snapshots
in `test/__toolsnaps__/` are the record of every schema change.

## [Unreleased]

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
