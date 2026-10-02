import { getMimeType, type CitationFormat } from '@open-access-explorer/shared';

/**
 * Hands the file to the browser.
 *
 * The revoke is deferred, and that is the whole of what this function had
 * wrong. Revoking straight after `click()` can cancel the download before the
 * browser has finished reading the blob — the anchor's click is dispatched
 * synchronously but the fetch of the object URL is not, so tearing the URL down
 * in the same tick is a race the download sometimes loses. `PaperActions`
 * already deferred it for exactly this reason on the PDF path; this is the same
 * fix on the export path, which produces the larger file of the two and so had
 * the wider window to lose in.
 */
export function downloadCitation(citation: string, filename: string, format: CitationFormat): void {
  const blob = new Blob([citation], { type: `${getMimeType(format)};charset=utf-8` });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
