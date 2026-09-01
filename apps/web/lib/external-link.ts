import { httpUrl } from '@open-access-explorer/shared';

/**
 * Opening a URL that came from somewhere else.
 *
 * Two separate defects, both of which live at a `window.open` call, which is
 * why they are fixed by one function rather than at six call sites.
 *
 * **The opener stayed attached.** Six calls read `window.open(url, '_blank')`
 * with no third argument. Anchors in this app all carry
 * `rel="noopener noreferrer"` correctly, but `window.open` never received the
 * implicit `noopener` that browsers eventually gave `<a target="_blank">` — the
 * opened page keeps a live `window.opener` and can navigate the tab it came
 * from, which is a phishing primitive rather than a theoretical one.
 *
 * **The scheme was never checked.** `bestPdfUrl` and `landingPage` arrive from
 * provider metadata, and `window.open('javascript:...')` runs in the *opener's*
 * origin. CORE decided a link was a PDF by testing whether it ended in `.pdf`,
 * which `javascript:alert(document.domain)//evil.pdf` does. The API now screens
 * these at the normalisers, so this is the second of two gates rather than the
 * only one — but it is the gate on the side where the damage would happen, and
 * a page rendering a record from anywhere else is still safe with it here.
 *
 * The URLs are not hypothetically attacker-controlled: CORE and OpenAIRE index
 * repository deposits, and repository metadata is written by whoever deposits.
 */

/**
 * Opens a URL in a new tab. Returns false, having done nothing, if the URL is
 * not one we will open.
 *
 * The return value reports the URL, not the tab. Setting `noopener` makes
 * `window.open` return null by specification, so a blocked pop-up and a
 * successful open are indistinguishable from here — claiming otherwise would
 * mean showing an error for tabs that opened fine. What a caller can act on is
 * the refusal, which is the case where there is genuinely nothing to show.
 */
export function openExternal(url: string | undefined | null): boolean {
  const safe = httpUrl(url);
  if (!safe) return false;

  // `noopener` is the one that matters; `noreferrer` implies it and is stated
  // alongside for the referrer itself. An unrecognised feature string is
  // ignored by browsers rather than fatal.
  window.open(safe, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * A URL safe to put in an `href`, or `undefined`.
 *
 * React renders a `javascript:` href with a warning rather than refusing it, so
 * a link built from provider metadata needs the same screening a `window.open`
 * does. Callers drop the link when this returns `undefined`.
 */
export function externalHref(url: string | undefined | null): string | undefined {
  return httpUrl(url);
}
