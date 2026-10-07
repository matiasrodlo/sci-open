---
name: systematic-search
description: Run a documented literature search with sci-open — build a query from the research question, tune it by its counts, screen the results, and keep a search log fit for a methods section. Use for literature, scoping or systematic reviews, or when the user wants "all" the papers on a topic.
---

# Systematic search

Keep a search log in a file the user names (default `search-log.md`), one row
per query: date, query, the filters line, its counts or its total, whether
the total is a lower bound, the coverage sentence, the handle (searches only)
and the result hash (the last line of each result). For the final query, also
log the list "Sent to each source" from its count: the search as each
database ran it, which a methods section reports.

1. Agree the scope with the user before searching. Searches return
   open-access papers only unless `open_access_only` is false; a review of a
   field usually needs closed papers too, which are listed with their
   metadata (`read_paper` reads open copies only). Settle the years and the
   publication type (`peer-reviewed` is journal articles, reviews, books and
   chapters, without preprints, theses, reports or notices), and log them.
   Then split the question into concepts — population, intervention or
   exposure, comparison, outcome, as apply — and list synonyms for each.
2. Write the query in the grammar from the server instructions: synonyms ORed
   in brackets, concepts ANDed, `PY=` for years. For example:
   `TS=("base editing" OR "base editor*") AND TS=(plant* OR crop*) AND PY=2018-2026`.
3. Tune with `search_papers` and `count_only: true`, which reads no results.
   Too many matches: narrow a concept. Too few: add synonyms, or truncate
   with `*`. Log every query you try, with its counts, not only the last.
   Counts are each source's own, so compare variants with them; never report
   one as the number of papers found.
4. A search reads only the top of each source's matches, and the counts say
   where that bites ("A search reads … the top 300"). For a review that must
   find every match, get every source read in full first: narrow the query,
   or split it into `PY=` ranges and run the steps below once per range. If
   the user settles for the top of each source instead, log that as a limit
   of the search.
5. With the final query, or each part of it, run `search_papers` without
   `count_only` at `page_size=10` and `detail="full"`, which shows each
   abstract, and page with `get_search_page` (`detail="full"` again) until
   `next` is null or the user's cap. "End of what was read" means the sources
   held more than was read: go back to step 4.
6. Screen titles and abstracts against the user's criteria. For an uncertain
   paper, `read_paper` with `view="outline"`, then its methods section. Exclude
   a paper marked `retracted`, and log it as excluded for that reason.
7. To check for papers the query missed, follow the citations of the most
   relevant included papers with `get_citations` (`references` backwards,
   `cited_by` forwards), and screen what it finds the same way. Log it as a
   citation search, with the papers it started from.
8. Export the included papers with `export_citations`, with `save_to` if the
   user wants a file, and list them with their DOIs in the log.

Report coverage as the results give it: if a source failed, or some sources
were read only in part, say the totals are lower bounds and name those
sources.
