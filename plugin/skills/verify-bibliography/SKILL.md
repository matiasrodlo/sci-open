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
4. Report a one-line count per verdict, then every reference that is not
   `verified`: its verdict, its issues in plain words, and the matched
   record's title, year and DOI when there is one.
   - `mismatch`: the DOI is wrong. Give the DOI the matched record carries.
   - `likely`: the paper exists but a detail differs. Say which.
   - `ambiguous`: more than one paper fits. List them and ask which was meant.
   - `not_found`: no source holds it. Say that, not "fabricated": very new
     and some closed papers can be missing too.
5. Offer `export_citations` for the verified and corrected entries, with
   `save_to` if the user wants a file. Never type BibTeX or RIS yourself: a
   retyped entry is where new errors come from.
