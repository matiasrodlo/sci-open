/**
 * Whether a configured API key is actually a key.
 *
 * `docs/env.example` ships placeholders like `your_datacite_api_key_here`, and
 * a `.env` copied from it has them in every slot. Sent as a credential they are
 * worse than nothing: DataCite answers `Authorization: Bearer
 * your_datacite_api_key_here` with **HTTP 401**, where the same request with no
 * header at all answers 200. So an unconfigured key does not degrade the
 * provider to anonymous access — it breaks it outright.
 *
 * The old aggregator layer guarded this in two places by hand. This is the
 * same check in one, applied where the key is used rather than where it is
 * read, so it holds however the value arrives.
 */
export function usableApiKey(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  // Matches every placeholder in the sample env file: `your_core_api_key_here`,
  // `your_datacite_api_key_here`, and so on.
  if (trimmed.startsWith('your_')) return undefined;
  return trimmed;
}
