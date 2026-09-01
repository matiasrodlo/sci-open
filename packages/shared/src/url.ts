/**
 * Whether a URL out of provider metadata is one we will hand to anybody.
 *
 * Nothing validated the *scheme* of a URL anywhere in the pipeline. Every
 * normaliser took whatever string the payload carried and wrote it into
 * `fullText.url` or `landingPage`, and the frontend passed it to
 * `window.open`. CORE decided a link was a PDF with
 * `url.toLowerCase().split('?')[0].endsWith('.pdf')`, which
 * `javascript:alert(document.domain)//evil.pdf` satisfies exactly as well as a
 * real file does. Measured: that string, and a `data:text/html,<script>...`
 * one, both came back out of `pickFullText` as `{ kind: 'pdf' }`.
 *
 * `window.open('javascript:...')` runs in the opener's origin, so the whole
 * chain from a deposited record to script execution on the site was open. And
 * the input is not hypothetically attacker-controlled: CORE and OpenAIRE index
 * repository deposits, and repository metadata is written by whoever deposits.
 *
 * Which is also why this lives in `shared` rather than in the API. The API is
 * where a bad URL should be stopped, and the browser is where the damage would
 * happen; both sides get to state the same rule rather than each keeping their
 * own idea of what a usable URL is.
 *
 * The rule is deliberately about the scheme alone. Whether a URL *resolves*,
 * whether it points somewhere private, and whether the file behind it is really
 * a PDF are three different questions, answered by `lib/pdf-proxy.ts` at the
 * point of fetching. This one says only that the value is a web address, which
 * is the question `javascript:` and `data:` fail.
 */

/** Everything a link, an `href`, or a download may use. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The URL if it is a usable web address, `undefined` otherwise.
 *
 * `undefined` rather than a thrown error, and rather than a sanitised
 * substitute: a record whose only advertised copy is a `javascript:` URL has no
 * copy, and saying so is what keeps it out of `total` and out of the facets.
 * Dropping the field is the honest report of that.
 */
export function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // A relative URL has no scheme to check and no origin to resolve against
    // out here, so it is not something we can hand on either.
    return undefined;
  }

  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
}

/** True when `value` is a URL we would hand on. */
export function isHttpUrl(value: unknown): boolean {
  return httpUrl(value) !== undefined;
}
