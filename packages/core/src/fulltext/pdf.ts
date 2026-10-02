import { extractText } from 'unpdf';
import { assertPublicHttpUrl, fetchPdfStream, MAX_PDF_BYTES } from '../lib/pdf-proxy';
import type { Section } from './types';

/**
 * A PDF as one section a page. Only a URL from the engine's own record is ever
 * passed here; the SSRF guard the API's /pdf route uses is the second line,
 * not the first. Text hidden in a PDF (white on white) is not detectable here;
 * the fence `read_paper` puts around it is the defence.
 */
export async function pdfToSections(rawUrl: string, userAgent: string): Promise<Section[]> {
  const url = await assertPublicHttpUrl(rawUrl);
  const { stream } = await fetchPdfStream(url, userAgent);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > MAX_PDF_BYTES) {
      stream.destroy();
      throw new Error('PDF exceeds the size limit');
    }
    chunks.push(chunk as Buffer);
  }
  return pagesToSections(Buffer.concat(chunks));
}

/** The text layer of each page, numbered from one; pages with none are left out. */
export async function pagesToSections(pdf: Uint8Array): Promise<Section[]> {
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: false });
  return text
    .map((page, i) => ({ id: `p${i + 1}`, title: `Page ${i + 1}`, text: page.trim() }))
    .filter(s => s.text);
}
