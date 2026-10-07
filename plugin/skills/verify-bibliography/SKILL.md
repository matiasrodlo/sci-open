---
name: verify-bibliography
description: Check every reference in a bibliography, manuscript or reference list against the literature with sci-open, and report the fabricated, garbled or mismatched ones. Use when the user asks whether citations are real, wants a reference list checked, or wants missing DOIs filled in.
---

# Verify a bibliography

1. Take the references from what the user gives you, one string each: a
   BibTeX entry's title, authors, year, venue and DOI; a manuscript's
   reference list, one entry per item. Check them as written. Do not tidy or
   complete a reference first: that hides exactly the errors being looked for.
2. Call `verify_references` with at most 25 references at a time, in order,
   and keep each result with the reference it checked.
3. A `not_checked` result is not a verdict. Wait the time its issue gives,
   then send only those references again.
4. Report a one-line count per verdict, then every reference marked
   `retracted` (an issue, whatever the verdict: the paper exists but was
   retracted, and cannot support a claim), then every reference that is not
   `verified`: its verdict, its issues in plain words, and the matched
   record's title, year and DOI when there is one.
   - `mismatch`: the DOI is wrong. `doi_target` is the paper the cited DOI
     actually belongs to. The correction is the DOI of the matched record,
     the paper the rest of the citation names; with no matched record
     (`cited_title_not_found`), say the DOI belongs to another paper and no
     paper with the cited title was found.
   - `likely`: the paper exists, but the citation differs from the record in
     a detail its issues name (the journal, part of the title). Give the
     record's version.
   - `ambiguous`: the closest record contradicts the citation in its year or
     its authors, or shares only part of its title. Give that record and its
     issues, and ask whether it was the paper meant.
   - `not_found`: no source holds it. Say that, not "fabricated": very new
     and some closed papers can be missing too.
5. Offer `export_citations` for the verified and corrected entries, with
   `save_to` if the user wants a file. Never type BibTeX or RIS yourself: a
   retyped entry is where new errors come from.
