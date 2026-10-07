## references (holdout), 2026-10-07

| Metric | Value |
|---|---|
| server | sci-open |
| mode | direct |
| references | 70 |
| upstreamRequests | 920 |
| upstreamRequestsPerReference | 13.143 |
| recallByType | {"none":1,"closed_real":1,"fabricated":1,"doi_wrong":1,"doi_invented":0.8571428571428571,"year_wrong":1,"preprint_version":1,"author_wrong":1} |
| flagPrecision | 1 |
| falseFabricatedRate | 0 |
| notChecked | 1 |

### Failures
- refs-16.json, doi_invented, graded ambiguous: Steinman, Ralph M., and Zanvil A. Cohn. 1973. “Identification of a novel cell type in peripheral lymphoid organs of mice. I. Morphology, quantitation, tissue distribution.” The Journal of Experimental Medicine 137 (5): 1142–1162. https://doi.org/10.1084/jem.137.5.9142.
  - matched europepmc:17182535, 2007, Journal of immunology (Baltimore, Md. : 1950)
  - doi_not_registered
  - year_mismatch: cited 1973, record 2007
  - venue_mismatch: the citation does not name the record's venue, Journal of immunology (Baltimore, Md. : 1950)
  - volume_mismatch: cited 137, record 178
  - pages_mismatch: cited from 1142, record from 5
  - title_partial_match: the cited title and the record's share 100% of the cited words

### Not checked
- refs-10.json: R. Gómez-Bombarelli et al., “Automatic chemical design using a data-driven continuous representation of molecules,” 2016, arXiv:1610.02415.
  - rate_limited: retry in 60 s
