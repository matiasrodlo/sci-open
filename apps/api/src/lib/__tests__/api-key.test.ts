import { describe, it, expect } from 'vitest';
import { usableApiKey } from '../api-key';

/**
 * Measured, and the reason this exists: DataCite answers
 * `Authorization: Bearer your_datacite_api_key_here` with HTTP 401, where the
 * same request carrying no header at all answers 200. An unconfigured key does
 * not degrade a provider to anonymous access — it breaks it.
 */
describe('usableApiKey', () => {
  it('rejects every placeholder the sample env file ships', () => {
    for (const placeholder of [
      'your_core_api_key_here',
      'your_ncbi_api_key_here',
      'your_doaj_api_key_here',
      'your_datacite_api_key_here',
      'your_opencitations_api_key_here'
    ]) {
      expect(usableApiKey(placeholder)).toBeUndefined();
    }
  });

  it('rejects an unset or blank value', () => {
    expect(usableApiKey(undefined)).toBeUndefined();
    expect(usableApiKey('')).toBeUndefined();
    expect(usableApiKey('   ')).toBeUndefined();
  });

  it('accepts a real key, trimmed', () => {
    expect(usableApiKey('  abc123  ')).toBe('abc123');
  });

  it('does not reject a real key that merely contains the word', () => {
    // The check is anchored, so a key is only refused for starting with the
    // placeholder prefix, not for containing it somewhere.
    expect(usableApiKey('k-your_key')).toBe('k-your_key');
  });
});
