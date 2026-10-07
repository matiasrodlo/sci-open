/**
 * Where in its venue a work appears: the volume, issue and pages a citation
 * gives after the journal's name. Strings, because they are not always
 * numbers — `e1000097` is a page, `Suppl 2` an issue — and a citation prints
 * them as the publisher wrote them.
 */
export type Biblio = {
  volume?: string;
  issue?: string;
  /** The first page, or the article number that stands in for one (`186802`, `e1000097`). */
  firstPage?: string;
  lastPage?: string;
};

const clean = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
};

/**
 * A last page as written in full. MEDLINE abbreviates it — `436-44` is pages
 * 436 to 444 — and a citation formatter would print the abbreviation as a
 * page before the first one.
 */
function fullLastPage(first: string, last: string): string {
  if (!/^\d+$/.test(first) || !/^\d+$/.test(last) || last.length >= first.length) return last;
  return first.slice(0, first.length - last.length) + last;
}

/** A page range as sources write it — `436-444`, `436–44`, `e1000097` — split in two. */
export function splitPages(pages: unknown): { firstPage?: string; lastPage?: string } {
  const text = clean(pages);
  if (!text) return {};
  const [first, last] = text.split(/\s*[-–—]\s*/, 2).map(part => part.trim());
  if (!first) return {};
  return { firstPage: first, ...(last ? { lastPage: fullLastPage(first, last) } : {}) };
}

/** A `Biblio` from whatever a source supplies, or undefined when it supplies none of it. */
export function biblioOf(parts: { volume?: unknown; issue?: unknown; firstPage?: unknown; lastPage?: unknown }): Biblio | undefined {
  const volume = clean(parts.volume);
  const issue = clean(parts.issue);
  const firstPage = clean(parts.firstPage);
  const lastPage = clean(parts.lastPage);
  const biblio: Biblio = {
    ...(volume ? { volume } : {}),
    ...(issue ? { issue } : {}),
    ...(firstPage ? { firstPage } : {}),
    ...(firstPage && lastPage && lastPage !== firstPage ? { lastPage: fullLastPage(firstPage, lastPage) } : {})
  };
  return Object.keys(biblio).length ? biblio : undefined;
}

/** The pages as a citation prints them: `354–359`, or the one page or article number. */
export function pagesOf(biblio: Biblio | undefined): string | undefined {
  if (!biblio?.firstPage) return undefined;
  return biblio.lastPage ? `${biblio.firstPage}–${biblio.lastPage}` : biblio.firstPage;
}

/** `{ biblio }` to spread into a record, or nothing when there is none. */
export function withBiblio(biblio: Biblio | undefined): { biblio?: Biblio } {
  return biblio ? { biblio } : {};
}
