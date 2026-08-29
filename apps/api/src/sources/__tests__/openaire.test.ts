import { describe, it, expect } from 'vitest';
import { OpenAIREConnector } from '../openaire';
import { readJson, normalizerOf, expectBaseRecord } from './fixtures';

const results = readJson('openaire.json').response.results.result;
const normalize = normalizerOf(new OpenAIREConnector(), 'normalizeResult');

describe('OpenAIRE normaliser', () => {
  it('maps every record in the fixture without throwing', () => {
    results.map((r: any) => normalize(r)).forEach((r: any) => expectBaseRecord(r, 'openaire'));
  });

  it('reads access rights from the JSON attribute shape', () => {
    // The JSON API prefixes attributes with "@"; the xml2js "$" shape only
    // applies to the XML path. Reading the wrong one left every record 'other'
    // and the OA filter then discarded the lot.
    expect(normalize(results[0])!.oaStatus).toBe('published');
  });

  /**
   * KNOWN DEFECT — flips to passing when phase 8 fixes OpenAIRE.
   *
   * Same root cause as the access-rights bug above, in the one place it was
   * not fixed: the pid loop reads `pidItem.$?.classid` and `pidItem._`, the
   * xml2js shape, while the JSON API supplies `@classid` and `$`. The DOI is
   * present in the payload and never reaches the record, so OpenAIRE results
   * cannot deduplicate by DOI against any other provider.
   */
  it.fails('extracts the DOI from the pid list', () => {
    const pid = results[0].metadata['oaf:entity']['oaf:result'].pid;
    const doiInSource = pid.find((p: any) => p['@classid'] === 'doi')?.$;
    expect(doiInSource).toMatch(/^10\./); // the DOI really is in the payload

    expect(normalize(results[0])!.doi).toBe(doiInSource);
  });
});
