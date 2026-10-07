## references (tune, with-openalex), 2026-10-07

| Metric | Value |
|---|---|
| server | sci-open |
| mode | direct |
| references | 130 |
| upstreamRequests | 2052 |
| upstreamRequestsPerReference | 15.785 |
| openalexCostUsd | 0.191 |
| recallByType | {"none":1,"preprint_version":0.6,"fabricated":1,"doi_wrong":1,"year_wrong":0.6923076923076923,"author_wrong":0.9230769230769231,"doi_invented":1,"closed_real":1} |
| flagPrecision | 0.969 |
| falseFabricatedRate | 0 |
| notChecked | 3 |

### Failures
- refs-03.json, year_wrong, graded likely: Shannon CE. A mathematical theory of communication. Bell System Technical Journal. 1951;27(3):379-423.
  - matched doi:10.1063/1.3067010, 1950, Physics Today
  - venue_mismatch: the citation does not name the record's venue, Physics Today
  - volume_mismatch: cited 27, record 3
  - pages_mismatch: cited from 379, record from 31
- refs-08.json, year_wrong, graded not_found: Petit, J. R., Jouzel, J., Raynaud, D., Barkov, N. I., Barnola, J.-M., Basile, I., Bender, M., Chappellaz, J., Davis, M., Delaygue, G., Delmotte, M., Kotlyakov, V. M., Legrand, M., Lipenkov, V. Y., Lorius, C., Pépin, L., Ritz, C., Saltzman, E., & Stievenard, M. (2003). Climate and atmospheric history of the past 420,000 years from the Vostok ice core, Antarctica. Nature, 399(6735), 429–436.
  - no_similar_title_in_any_source
- refs-08.json, preprint_version, graded ambiguous: Rolnick, D., Donti, P. L., Kaack, L. H., Kochanski, K., Lacoste, A., Sankaran, K., Ross, A. S., Milojevic-Dupont, N., Jaques, N., Waldman-Brown, A., Luccioni, A., Maharaj, T., Sherwin, E. D., Mukkavilli, S. K., Kording, K. P., Gomes, C., Ng, A. Y., Hassabis, D., Platt, J. C., . . . Bengio, Y. (2019). Tackling Climate Change with Machine Learning. arXiv. https://doi.org/10.48550/arXiv.1906.05433
  - doi_registered_but_not_indexed
- refs-09.json, author_wrong, graded not_found: Brandt, K., Moreau, J. & Ilić, D. Experimental Test of Bell's Inequalities Using Time-Varying Analyzers. Phys. Rev. Lett. 49, 1804–1807 (1982).
  - no_similar_title_in_any_source
- refs-17.json, preprint_version, graded ambiguous: Barabasi, A.-L., & Albert, R. (1999). Emergence of scaling in random networks. arXiv. https://doi.org/10.48550/arXiv.cond-mat/9910332
  - doi_registered_but_not_indexed
- refs-18.json, year_wrong, graded likely: Morgan, W. J. Rises, trenches, great faults, and crustal blocks. J. Geophys. Res. 73, 1959–1982 (1972).
  - matched doi:10.1002/9781118782149.ch5, 1972, Collected reprint series
  - venue_mismatch: the citation does not name the record's venue, Collected reprint series
- refs-20.json, year_wrong, graded not_found: K. M. Chandy and L. Lamport, “Distributed snapshots: determining global states of distributed systems,” ACM Trans. Comput. Syst., vol. 3, no. 1, pp. 63–75, 1989.
  - no_similar_title_in_any_source

### Not checked
- refs-09.json: LIGO Scientific Collaboration & Virgo Collaboration. Observation of Gravitational Waves from a Binary Black Hole Merger. Preprint at https://arxiv.org/abs/1602.03837 (2016).
  - rate_limited: retry in 60 s
- refs-11.json: Mathis A, Mamidanna P, Abe T, et al. Markerless tracking of user-defined features with deep learning. arXiv:1804.03142. 2018.
  - lookup_failed: upstream_unavailable
- refs-20.json: P. W. Shor, “Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer,” 1995, arXiv:quant-ph/9508027.
  - lookup_failed: upstream_unavailable
