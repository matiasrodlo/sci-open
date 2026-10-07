/**
 * The eight 16-bit groups of an IPv6 address, or `undefined` if it does not
 * parse.
 *
 * Parsed rather than matched as text because the same address has many
 * spellings, and the URL parser picks a different one from the one a caller
 * typed: `http://[::ffff:127.0.0.1]/` reaches the PDF fetch as `::ffff:7f00:1`.
 * A check written against the dotted spelling never saw the hex one, so an
 * IPv4-mapped literal walked straight past it to loopback — and an IP literal
 * is never handed to `guardedLookup`, because Node skips DNS for one. The PDF
 * fetch refuses an address that does not parse; `sci-open-mcp --http` keys a
 * client's budgets by these groups too.
 */
export function ipv6Groups(ip: string): number[] | undefined {
  let text = ip.toLowerCase().replace(/%.*$/, '');

  // A trailing dotted quad is the last two groups written in decimal.
  const dotted = text.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    if ([a, b, c, d].some(n => n > 255)) return undefined;
    text = `${text.slice(0, text.length - dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return undefined;

  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map(group =>
    /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN
  );
  return groups.every(Number.isInteger) ? groups : undefined;
}
