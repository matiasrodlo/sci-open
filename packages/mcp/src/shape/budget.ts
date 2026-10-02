export type WholeItemFit<T> = { kept: T[]; omitted: number };

/**
 * Keep a prefix of `items` whose serialized size fits `maxChars`. Never cuts
 * inside an item and never skips one to fit a later, smaller one — so the
 * omitted items are exactly the tail of the page, and the response can say
 * how many were left off. The first item is always kept: an answer of nothing
 * would say less than one too large.
 */
export function fitWholeItems<T>(items: readonly T[], maxChars: number, measure = (x: T) => JSON.stringify(x).length): WholeItemFit<T> {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = measure(item);
    if (used + size > maxChars && kept.length > 0) break;
    kept.push(item);
    used += size;
  }
  return { kept, omitted: items.length - kept.length };
}

/**
 * For text the model reads: cut at a line boundary and say how to get the
 * rest. A budget is a safety net, not the main mechanism — page sizes are
 * chosen so normal calls never reach it — and when it binds, the response
 * says so and how to continue rather than silently dropping data.
 */
export function clampText(text: string, maxChars: number, continuation: string): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf('\n', maxChars);
  let kept = text.slice(0, cut > maxChars * 0.5 ? cut : maxChars);
  // A cut inside an untrusted fence must close it: left open, everything after
  // the tag — this note included — would read as third-party data.
  const open = [...kept.matchAll(/^<(untrusted-[0-9a-f-]{36})>$/gm)].pop()?.[1];
  if (open && !kept.includes(`</${open}>`)) kept += `\n</${open}>`;
  return `${kept}\n\n[Truncated to fit the response limit. ${continuation}]`;
}
