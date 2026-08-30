import { expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import type { OARecord } from '@open-access-explorer/shared';

const DIR = path.resolve(__dirname, '../../__fixtures__');

export function readJson<T = any>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
}

export function readText(name: string): string {
  return fs.readFileSync(path.join(DIR, name), 'utf8');
}

export function readXml(name: string): Promise<any> {
  return parseStringPromise(readText(name));
}

/**
 * Normalisers are private methods. Testing them through `search()` would mean
 * stubbing HTTP and would fold query translation into the same assertion; the
 * point here is to pin field mapping alone, so reach past the modifier rather
 * than widening the production surface for the tests' benefit.
 */
export function normalizerOf<T extends object>(connector: T, method: string) {
  const fn = (connector as any)[method];
  if (typeof fn !== 'function') {
    throw new Error(`${connector.constructor.name} has no ${method}`);
  }
  return (...args: unknown[]) => fn.apply(connector, args) as OARecord | null;
}

/**
 * Fields every connector is expected to populate for every record, whatever
 * else it does or does not supply.
 */
export function expectBaseRecord(record: OARecord | null, source: string) {
  if (!record) throw new Error('normaliser returned null');
  expect(record.id).toMatch(new RegExp(`^${source}:`));
  expect(record.source).toBe(source);
  expect(typeof record.title).toBe('string');
  expect(record.title.length).toBeGreaterThan(0);
  expect(Array.isArray(record.authors)).toBe(true);
  expect(record.sourceId).toBeTruthy();
}
