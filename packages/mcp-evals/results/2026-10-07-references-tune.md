## references (tune), 2026-10-07

| Metric | Value |
|---|---|
| server | sci-open |
| mode | direct |
| references | 130 |
| upstreamRequests | 1676 |
| upstreamRequestsPerReference | 12.892 |
| recallByType | {"none":1,"preprint_version":1,"fabricated":1,"doi_wrong":1,"year_wrong":0.8461538461538461,"author_wrong":1,"doi_invented":0.9230769230769231,"closed_real":1} |
| flagPrecision | 1 |
| falseFabricatedRate | 0 |
| notChecked | 2 |

### Failures
- refs-03.json, year_wrong, graded likely: Shannon CE. A mathematical theory of communication. Bell System Technical Journal. 1951;27(3):379-423.
  - matched doi:10.1063/1.3067010, 1950, Physics Today
  - venue_mismatch: the citation does not name the record's venue, Physics Today
  - volume_mismatch: cited 27, record 3
  - pages_mismatch: cited from 379, record from 31
- refs-09.json, doi_invented, graded ambiguous: Castro Neto, A. H., Guinea, F., Peres, N. M. R., Novoselov, K. S. & Geim, A. K. The electronic properties of graphene. Rev. Mod. Phys. 81, 109–162 (2009). https://doi.org/10.1103/RevModPhys.81.10999
  - matched doi:10.1021/nl102824h, 2010, Nano Letters
  - doi_not_registered
  - author_mismatch: no cited surname appears in the record
  - venue_mismatch: the citation does not name the record's venue, Nano Letters
  - volume_mismatch: cited 81, record 10
  - pages_mismatch: cited from 109, record from 4285
  - title_partial_match: the cited title and the record's share 100% of the cited words
- refs-18.json, year_wrong, graded likely: Morgan, W. J. Rises, trenches, great faults, and crustal blocks. J. Geophys. Res. 73, 1959–1982 (1972).
  - matched doi:10.1002/9781118782149.ch5, 1972, Collected Reprint Series
  - venue_mismatch: the citation does not name the record's venue, Collected Reprint Series

### Not checked
- refs-11.json: Mathis A, Mamidanna P, Abe T, et al. Markerless tracking of user-defined features with deep learning. arXiv:1804.03142. 2018.
  - rate_limited: retry in 60 s
- refs-20.json: P. W. Shor, “Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer,” 1995, arXiv:quant-ph/9508027.
  - rate_limited: retry in 60 s
