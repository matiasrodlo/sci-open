import { extractText } from 'unpdf';
import { assertPublicHttpUrl, fetchPdfStream } from '../lib/pdf-fetch';
import type { Section } from './types';

/**
 * A PDF as one section a page. Only a URL from the engine's own record is ever
 * passed here; the SSRF guard is the second line, not the first. Text hidden in a PDF (white on white) is not detectable here;
 * the fence `read_paper` puts around it is the defence.
 */
export async function pdfToSections(rawUrl: string, userAgent: string, signal?: AbortSignal): Promise<Section[]> {
  const url = await assertPublicHttpUrl(rawUrl);
  // The stream fails past the size cap, so reading it whole is bounded.
  const chunks: Buffer[] = [];
  for await (const chunk of await fetchPdfStream(url, userAgent, signal)) chunks.push(chunk as Buffer);
  // Parsing cannot be stopped once it starts; a read stopped by now is not begun.
  signal?.throwIfAborted();
  return pagesToSections(Buffer.concat(chunks));
}

/** The text layer of each page, numbered from one; pages with none are left out. */
export async function pagesToSections(pdf: Uint8Array): Promise<Section[]> {
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: false });
  return text
    .map((page, i) => ({ id: `p${i + 1}`, title: `Page ${i + 1}`, text: page.trim() }))
    .filter(s => s.text);
}
