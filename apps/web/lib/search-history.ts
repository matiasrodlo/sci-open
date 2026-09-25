/**
 * The numbered searches this session has run, and what `#1` resolves to.
 *
 * Web of Science numbers every search and lets you combine the numbers, which
 * is how a long query gets assembled without ever being typed as one. The
 * combining itself is `expandSets` in the shared grammar; this is the part that
 * has to decide *where the numbers live*, and there is only one honest answer
 * for this app.
 *
 * `/results` is a server component rendered from the URL and nothing else.
 * There are no accounts and no store — Redis here is a cache, and a cache is not
 * somewhere a reader's search history can live. So the history is the browser's,
 * and a reference is expanded **before** navigating rather than sent along with
 * the search.
 *
 * That ordering is the important part, and it is not only an implementation
 * convenience. A URL carrying `q=%231 AND %232` would mean something different
 * to every reader who opened it, and nothing at all to one whose session had
 * expired — a shared link to a search would silently become a different search.
 * Expanding first makes `q` say what was actually asked, so the link keeps
 * meaning it.
 *
 * `sessionStorage`, not `localStorage`: a numbered history belongs to a sitting,
 * the way it does in Web of Science. Numbers restarting from #1 in a new tab is
 * the behaviour a reader expects, and a month-old #7 resurfacing is not.
 *
 * Every access is wrapped. Storage throws in a private window and in a browser
 * with site data blocked, and a search box that will not accept a query because
 * the history could not be read would be a worse failure than having no history.
 */

export type SearchSet = {
  /** As displayed: `#1`. Stable for the life of the session — see `record`. */
  number: number;
  /**
   * What the reader typed, references and all, so the history reads back the way
   * it was written: `#1 NOT AU=Doudna` rather than the expansion of it.
   */
  label: string;
  /**
   * What actually ran, and what `#N` substitutes. Already expanded, which is
   * what makes `expandSets` a single pass with no recursion to bound.
   */
  expanded: string;
  /**
   * How many papers match it, once the search that produced it has come back —
   * the same figure the results header shows, so the two never disagree.
   */
  total?: number;
  /**
   * True when `total` is a floor: more match, and how many more is not known.
   * Shown as the `+` after it. See `Matching` in `lib/coverage.ts`.
   */
  atLeast?: boolean;
  at: string;
};

const KEY = 'sci-open:search-history';

/**
 * Enough for a working session and far short of anything `sessionStorage` would
 * object to. The oldest go first when it is reached, and their numbers are *not*
 * reused — see `record`.
 */
const MAX_SETS = 50;

function load(): SearchSet[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Validated rather than trusted. This is the reader's own storage, but it
    // is still input: another tab, an older build of this app, or a hand-edited
    // value can all put something else here, and a malformed entry would
    // otherwise reach `expandSets` as a set number pointing at `undefined`.
    return parsed.filter((entry): entry is SearchSet =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as SearchSet).number === 'number'
      && Number.isInteger((entry as SearchSet).number)
      && (entry as SearchSet).number >= 1
      && typeof (entry as SearchSet).label === 'string'
      && typeof (entry as SearchSet).expanded === 'string'
      && (entry as SearchSet).expanded.trim() !== ''
    );
  } catch {
    return [];
  }
}

/**
 * Announced so the panel can update when something else writes.
 *
 * The two live in different Suspense boundaries on `/results` — the search box
 * renders immediately, and the total is only known once the search comes back —
 * so the component that records is not the component that displays. A `storage`
 * event would not do it: browsers fire that at *other* tabs, never at the one
 * that wrote.
 */
export const HISTORY_CHANGED = 'sci-open:search-history-changed';

function save(sets: readonly SearchSet[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(sets));
  } catch {
    // Full, blocked, or a private window. The history is a convenience and the
    // search itself does not depend on it, so this is where that ends.
  }
  // Outside the try: a panel that cannot be told about a write it did not make
  // shows a stale list, whether or not the write reached storage.
  window.dispatchEvent(new CustomEvent(HISTORY_CHANGED));
}

export function readHistory(): SearchSet[] {
  if (typeof window === 'undefined') return [];
  return load();
}

/**
 * The array `expandSets` takes, indexed so that position `N - 1` is set `#N`.
 *
 * Numbers are stable and eviction leaves gaps, so this is built by number
 * rather than by walking the list — the fifth entry is not necessarily `#5`.
 * A gap is an empty string, which `expandSets` reports as a dropped set rather
 * than resolving to the wrong search.
 */
export function setTexts(sets: readonly SearchSet[]): string[] {
  const highest = sets.reduce((max, set) => Math.max(max, set.number), 0);
  const texts = new Array<string>(highest).fill('');
  for (const set of sets) texts[set.number - 1] = set.expanded;
  return texts;
}

/**
 * Records a search, and returns the history it produced.
 *
 * **The same search does not become a new set.** Web of Science numbers every
 * execution, and here that would be unusable: `/results` re-renders on every
 * page of a result set, every sort change and every facet tick, and each one
 * would mint another identical number. Matching on the expanded text means
 * paging through results leaves the history alone, and the count is refreshed
 * on the set that is already there.
 *
 * **Numbers are never reused.** A new set takes one above the highest ever
 * issued, not one above the list length, so evicting `#1` cannot make the next
 * search `#1` and quietly redirect a reference the reader has already typed.
 */
export function record(entry: {
  label: string;
  expanded: string;
  total?: number;
  atLeast?: boolean;
}): SearchSet[] {
  if (typeof window === 'undefined') return [];

  const expanded = entry.expanded.trim();
  if (!expanded) return load();

  // The count and its `+` travel together. A set that was a floor and is now
  // exact has to lose the `+`, which spreading the new fields over the old
  // ones would not do.
  const count = (set: SearchSet): SearchSet => {
    if (entry.total === undefined) return set;
    const { total: _total, atLeast: _atLeast, ...rest } = set;
    return { ...rest, total: entry.total, ...(entry.atLeast ? { atLeast: true } : {}) };
  };

  const sets = load();
  const existing = sets.find(set => set.expanded === expanded);

  if (existing) {
    const updated = sets.map(set => (set === existing ? count(set) : set));
    save(updated);
    return updated;
  }

  const next: SearchSet = count({
    number: sets.reduce((max, set) => Math.max(max, set.number), 0) + 1,
    label: entry.label.trim() || expanded,
    expanded,
    at: new Date().toISOString()
  });

  const updated = [...sets, next].slice(-MAX_SETS);
  save(updated);
  return updated;
}

export function clearHistory(): SearchSet[] {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // As in `save`.
  }
  window.dispatchEvent(new CustomEvent(HISTORY_CHANGED));
  return [];
}

/**
 * What the reader typed, carried from the search box to the results page.
 *
 * The URL holds the expanded query — that is the whole point of expanding
 * before navigating — so the typed form would otherwise be lost at exactly the
 * moment the history wants to record it. This hands it across the navigation
 * and is read once.
 *
 * Missing is normal and not an error: a reader who opened a results URL
 * directly, reloaded, or followed a shared link never typed anything. The
 * expanded query stands in as its own label then, which is what it is.
 */
const PENDING_KEY = 'sci-open:pending-label';

export function rememberLabel(label: string, expanded: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ label, expanded }));
  } catch {
    // As in `save`.
  }
}

export function takeLabel(expanded: string): string | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return undefined;

    window.sessionStorage.removeItem(PENDING_KEY);

    const parsed = JSON.parse(raw) as { label?: unknown; expanded?: unknown };
    // Only when it belongs to *this* search. A label left behind by an
    // abandoned navigation must not be attached to whatever is rendered next.
    if (typeof parsed.label !== 'string' || parsed.expanded !== expanded) return undefined;

    return parsed.label;
  } catch {
    return undefined;
  }
}
