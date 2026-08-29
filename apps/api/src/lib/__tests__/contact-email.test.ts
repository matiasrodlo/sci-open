import { describe, it, expect } from 'vitest';
import { extractContactEmail, isPlaceholderContact } from '../contact-email';

describe('extractContactEmail', () => {
  it('stops at the closing bracket, not just at whitespace', () => {
    // Splitting on a space returned `someone@example.com)`, which is what went
    // out as the `email` parameter however UNPAYWALL_EMAIL was configured.
    expect(extractContactEmail('OpenAccessExplorer/1.0 (mailto:someone@example.com)')).toBe(
      'someone@example.com'
    );
  });

  it.each([
    ['OpenAccessExplorer/1.0 (mailto:a@b.io) trailing', 'a@b.io'],
    ['App/2 <mailto:a@b.io>', 'a@b.io'],
    ['App/2 [mailto:a@b.io]', 'a@b.io'],
    ['mailto:a@b.io', 'a@b.io'],
    ['App/1 (MAILTO:Caps@B.io)', 'Caps@B.io']
  ])('extracts from %s', (ua, expected) => {
    expect(extractContactEmail(ua)).toBe(expected);
  });

  it('treats the shipped placeholder as no address at all', () => {
    expect(extractContactEmail('OpenAccessExplorer/1.0 (mailto:your-email@example.com)')).toBeUndefined();
    expect(isPlaceholderContact('OpenAccessExplorer/1.0 (mailto:your-email@example.com)')).toBe(true);
  });

  it('returns undefined when there is no mailto at all', () => {
    expect(extractContactEmail('OpenAccessExplorer/1.0')).toBeUndefined();
  });
});
