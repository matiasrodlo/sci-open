import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * The headers every page is sent. There were none: no policy, no framing
 * rule, and `X-Powered-By: Next.js` on every response.
 */

const require = createRequire(import.meta.url);
const config = require('../../next.config.js');

const headersFor = async () => {
  const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await config.headers();
  return rules;
};

describe('security headers', () => {
  it('sends a policy that loads nothing from elsewhere and refuses to be framed', async () => {
    const [rule] = await headersFor();
    const policy = rule!.headers.find(h => h.key === 'Content-Security-Policy')!.value;

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/https:|\*/);
    expect(rule!.headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
    expect(rule!.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
  });

  it('applies to every page and leaves the API proxy’s own headers alone', async () => {
    const [rule] = await headersFor();
    const matches = (path: string) => new RegExp(`^${rule!.source}$`).test(path);

    expect(matches('/')).toBe(true);
    expect(matches('/results')).toBe(true);
    expect(matches('/paper/europepmc%3A1')).toBe(true);
    expect(matches('/api/v2/search')).toBe(false);
  });

  it('does not announce the framework', () => {
    expect(config.poweredByHeader).toBe(false);
  });
});
