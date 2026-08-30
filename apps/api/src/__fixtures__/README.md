# Connector fixtures

One recorded response per provider. The normaliser suites read these instead
of calling the live APIs, which is what makes `pnpm test` deterministic,
offline, and fast enough to run on every commit.

**These outlive the connectors that produced them.** They were recorded in
phase 01 and lived in `src/sources/__fixtures__/` until phase 10's audit found
that fourteen test files across eight migrated providers read them from there
— inside the directory phase 10 is scheduled to delete. Deleting the old
connectors would have taken the recorded responses with them and broken the
`normalize` suites of arxiv, biorxiv, datacite, doaj, europepmc, ncbi, openaire
and plos: not the parity tests, which are meant to go, but the tests that pin
what the new normalisers read. They sit at `src/__fixtures__/` now, belonging
to neither path.

Recorded on 2026-08-28 for the query `crispr gene editing`, trimmed to a
handful of records each — they exist to pin field mapping, not to be a corpus.

| File | Provider | Notes |
| --- | --- | --- |
| `arxiv.xml` | arXiv | Atom feed, parsed with xml2js |
| `biorxiv.json` | bioRxiv | A date-window page; the API has no keyword endpoint |
| `datacite.json` | DataCite | |
| `doaj.json` | DOAJ | |
| `europepmc.json` | Europe PMC | `resultType=core` |
| `ncbi-esearch.json` | PubMed | The id list |
| `ncbi-efetch.xml` | PubMed | Abstract XML for those ids |
| `openaire.json` | OpenAIRE | One record; the payload is ~200 KB per result |
| `plos.json` | PLOS | Solr response |

CORE is missing because it needs an API key; set `CORE_API_KEY` and re-record
to add it.

## Re-recording

```
pnpm --filter @open-access-explorer/api exec tsx scripts/record-fixtures.ts
```

Do this only when a provider changes its response shape, and read the diff:
a fixture is the contract its suite asserts against, so a change here is a
change to what the connector is expected to handle.

## Known upstream oddities

These are in the providers' own data, not artefacts of recording — leave them
in place, they are the kind of input the normalisers have to survive:

- `datacite.json` contains `Universit� degli Studi di Siena`. DataCite
  serves that replacement character itself; it is not a decoding bug here.
- OpenAIRE records carry the DOI under `pid[]` with an `@classid` key. The
  connector reads the xml2js `$` shape instead and drops it — see the expected
  failure in `openaire.test.ts`.
