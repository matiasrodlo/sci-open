/**
 * Both OpenAlex and Unpaywall ask callers to identify themselves with a
 * contact address, and both treat a request that does so as belonging to a
 * more generous rate-limit pool. The address travels in the User-Agent this
 * service builds at startup, so the clients read it back out of there rather
 * than taking it as a second constructor argument that could drift from it.
 */

const PLACEHOLDER = 'your-email@example.com';

/**
 * Pull the address out of a `mailto:` in the User-Agent.
 *
 * The delimiter set matters: the User-Agent wraps the address in parentheses,
 * and splitting on whitespace alone returns `someone@example.com)` — a
 * malformed address that these APIs reject, which is how a correctly
 * configured UNPAYWALL_EMAIL could still be sent unusable.
 */
export function extractContactEmail(userAgent: string): string | undefined {
  const match = userAgent.match(/mailto:\s*([^\s)>\]]+)/i);
  const email = match?.[1];

  if (!email || email === PLACEHOLDER) {
    return undefined;
  }

  return email;
}

export function isPlaceholderContact(userAgent: string): boolean {
  return extractContactEmail(userAgent) === undefined;
}
