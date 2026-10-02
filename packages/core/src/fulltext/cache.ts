import type { FullTextDocument } from './types';

type Entry = { doc: FullTextDocument | null; bytes: number; expires: number };

export type FullTextCacheOptions = { maxBytes?: number; ttlMs?: number; missTtlMs?: number; now?: () => number };

export const DEFAULT_FULL_TEXT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Full texts read recently, by paper. A document is expensive — a PDF fetch
 * and parse, or a paced arXiv request — and is read in several calls: the
 * outline, then sections. Held for an hour, in a byte budget; a paper with no
 * legal copy is held as a miss for ten minutes, so it is not looked for on
 * every call. Map order is eviction order: a read re-inserts, so the oldest
 * unread goes first.
 */
export class FullTextCache {
  private readonly entries = new Map<string, Entry>();
  private held = 0;

  constructor(private readonly options: FullTextCacheOptions = {}) {}

  /** The held document, `null` for a held miss, `undefined` when nothing is held. */
  get(key: string): FullTextDocument | null | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.drop(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.doc;
  }

  set(key: string, doc: FullTextDocument | null): void {
    this.drop(key);
    const max = this.options.maxBytes ?? DEFAULT_FULL_TEXT_MAX_BYTES;
    // JS strings are UTF-16: two bytes a character, plus the record around them.
    const bytes = doc ? doc.totalChars * 2 + 1024 : 64;
    if (bytes > max) return; // larger than the whole cache: served, not held
    const ttl = doc ? (this.options.ttlMs ?? 3_600_000) : (this.options.missTtlMs ?? 600_000);
    this.entries.set(key, { doc, bytes, expires: this.now() + ttl });
    this.held += bytes;
    for (const [oldest] of this.entries) {
      if (this.held <= max) break;
      this.drop(oldest);
    }
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.held };
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.held -= entry.bytes;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
