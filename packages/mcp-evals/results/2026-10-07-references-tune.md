## references (tune), 2026-10-07

| Metric | Value |
|---|---|
| server | sci-open |
| mode | direct |
| references | 130 |
| upstreamRequests | 1816 |
| upstreamRequestsPerReference | 13.969 |
| recallByType | {"none":1,"preprint_version":1,"fabricated":1,"doi_wrong":1,"year_wrong":0.9230769230769231,"author_wrong":1,"doi_invented":1,"closed_real":1} |
| flagPrecision | 1 |
| falseFabricatedRate | 0 |
| notChecked | 2 |

### Failures
- refs-18.json, year_wrong, graded likely: Morgan, W. J. Rises, trenches, great faults, and crustal blocks. J. Geophys. Res. 73, 1959–1982 (1972).
  - matched doi:10.1002/9781118782149.ch5, 1972, Collected Reprint Series
  - venue_mismatch: the citation does not name the record's venue, Collected Reprint Series

### Not checked
- refs-11.json: Mathis A, Mamidanna P, Abe T, et al. Markerless tracking of user-defined features with deep learning. arXiv:1804.03142. 2018.
  - rate_limited: retry in 60 s
- refs-20.json: P. W. Shor, “Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer,” 1995, arXiv:quant-ph/9508027.
  - rate_limited: retry in 60 s
