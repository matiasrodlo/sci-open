## references (tune, without-openalex), 2026-10-07

| Metric | Value |
|---|---|
| server | sci-open |
| mode | direct |
| without | openalex |
| references | 130 |
| upstreamRequests | 1749 |
| upstreamRequestsPerReference | 13.454 |
| openalexCostUsd | 0 |
| recallByType | {"none":1,"preprint_version":1,"fabricated":0.9230769230769231,"doi_wrong":0.9230769230769231,"year_wrong":0.8461538461538461,"author_wrong":1,"doi_invented":0.9230769230769231,"closed_real":0.9375} |
| flagPrecision | 0.985 |
| falseFabricatedRate | 0 |
| notChecked | 4 |

### Failures
- refs-01.json, fabricated, graded ambiguous: Okafor L, Brandt P. Quantum annealing of protein folding landscapes. Nature. 2021;590:112-118.
  - matched doi:10.1038/s41598-026-46916-w, 2026, Scientific Reports
  - year_mismatch: cited 2021, record 2026
  - author_mismatch: no cited surname appears in the record
  - venue_mismatch: the citation does not name the record's venue, Scientific Reports
  - volume_mismatch: cited 590, record 16
  - pages_mismatch: cited from 112, record from 12035
  - title_partial_match: the cited title and the record's share 80% of the cited words
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
- refs-17.json, closed_real, graded ambiguous: Granovetter, M. S. (1973). The Strength of Weak Ties. American Journal of Sociology, 78(6), 1360–1380. https://doi.org/10.1086/225469
  - doi_registered_but_not_indexed
- refs-20.json, year_wrong, graded not_found: K. M. Chandy and L. Lamport, “Distributed snapshots: determining global states of distributed systems,” ACM Trans. Comput. Syst., vol. 3, no. 1, pp. 63–75, 1989.
  - no_similar_title_in_any_source
- refs-20.json, doi_wrong, graded ambiguous: R. L. Rivest, A. Shamir, and L. Adleman, “A method for obtaining digital signatures and public-key cryptosystems,” Commun. ACM, vol. 21, no. 2, pp. 120–126, 1978, doi: 10.1145/362384.362685.
  - doi_registered_but_not_indexed

### Not checked
- refs-03.json: Kaplan J, McCandlish S, Henighan T, et al. Scaling laws for neural language models. arXiv:2001.08361. 2020.
  - rate_limited: retry in 60 s
- refs-09.json: LIGO Scientific Collaboration & Virgo Collaboration. Observation of Gravitational Waves from a Binary Black Hole Merger. Preprint at https://arxiv.org/abs/1602.03837 (2016).
  - rate_limited: retry in 60 s
- refs-11.json: Mathis A, Mamidanna P, Abe T, et al. Markerless tracking of user-defined features with deep learning. arXiv:1804.03142. 2018.
  - rate_limited: retry in 60 s
- refs-20.json: P. W. Shor, “Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer,” 1995, arXiv:quant-ph/9508027.
  - rate_limited: retry in 60 s
