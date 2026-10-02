---
name: systematic-search
description: Run a documented literature search with sci-open — build a query from the research question, tune it by its counts, screen the results, and keep a search log fit for a methods section. Use for literature, scoping or systematic reviews, or when the user wants "all" the papers on a topic.
---

# Systematic search

Keep a search log in a file the user names (default `search-log.md`), one row
per query: date, query, its counts or its total, whether the total is a lower
bound, the coverage sentence, the handle (searches only) and the result hash
(the last line of each result).

1. Split the question into concepts — population, intervention or exposure,
   comparison, outcome, as apply — and list synonyms for each.
2. Write the query in the grammar from the server instructions: synonyms ORed
   in brackets, concepts ANDed, `PY=` for years. For example:
   `TS=("base editing" OR "base editor*") AND TS=(plant* OR crop*) AND PY=2018-2026`.
3. Tune with `search_papers` and `count_only: true`, which reads no results.
   Too many matches: narrow a concept. Too few: add synonyms, or truncate
   with `*`. Log every query you try, with its counts, not only the last.
   Counts are each source's own, so compare variants with them; never report
   one as the number of papers found.
4. With the final query, run `search_papers` without `count_only` at
   `page_size=25`, and page with `get_search_page` until `next` is null or the
   user's cap.
5. Screen titles and abstracts against the user's criteria. For an uncertain
   paper, `read_paper` with `view="outline"`, then its methods section. Exclude
   a paper marked `retracted`, and log it as excluded for that reason.
6. To check for papers the query missed, follow the citations of the most
   relevant included papers with `get_citations` (`references` backwards,
   `cited_by` forwards), and screen what it finds the same way. Log it as a
   citation search, with the papers it started from.
7. Export the included papers with `export_citations`, with `save_to` if the
   user wants a file, and list them with their DOIs in the log.

Report coverage as the results give it: if a source failed, say the totals
are lower bounds and name the sources that were missing.
