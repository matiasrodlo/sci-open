# sci-open

An MCP server for open-access scientific literature: search seven sources at
once, look a paper up in eleven, verify reference lists, read full text, follow
and export citations — and be told what was **not** found.

A search asks arXiv, DOAJ, Europe PMC, OpenAIRE, OpenAlex, PLOS and PubMed. A
DOI is also looked up in bioRxiv/medRxiv, CORE and DataCite, which a keyword
search does not ask: bioRxiv has no keyword index, CORE answers too slowly,
and DataCite's records are datasets and theses with no copy to read. Crossref
is searched too when closed papers are asked for, and for every DOI: it says
whether a paper is open for none of its records. Crossref, Unpaywall and
OpenCitations are asked about the papers found.

## Install

```bash
claude mcp add sci-open --env UNPAYWALL_EMAIL=you@example.org -- npx -y sci-open-mcp
```

Or, in Claude Code, as a plugin with the `verify-bibliography` and
`systematic-search` skills:

```
/plugin marketplace add matiasrodlo/sci-open
/plugin install sci-open@sci-open
```

Other clients, the tools, the `sci-open` CLI and hosting over HTTP are in
[packages/mcp/README.md](./packages/mcp/README.md).

## Repository

```
sci-open/
├── packages/
│   ├── mcp/          # sci-open-mcp: the MCP server and the sci-open CLI
│   ├── core/         # the search engine: providers, authorities, orchestrator
│   ├── shared/       # types, query grammar, citation formatter
│   └── mcp-evals/    # tool-selection, reading and reference evaluations
├── plugin/           # the Claude Code plugin: server config and skills
└── docs/             # the MCP implementation manual
```

## Development

**Prerequisites:** Node.js 22.12+, pnpm 8

```bash
pnpm install
pnpm build
pnpm test        # offline, against committed fixtures
pnpm typecheck
pnpm lint
```

The design, and the order it was built in, is
[docs/mcp-implementation-manual.md](./docs/mcp-implementation-manual.md).

## License

MIT License
