import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ShippingPolicy } from '@apokorg/core';
import { getShippingPolicy, isStale, loadShippingPolicies } from './shipping';

const V1 = ['apotea', 'hjartat', 'apoteket', 'doz', 'kronans', 'gymgrossisten', 'lyko'];
const dir = new URL('../shipping/', import.meta.url);

describe('shipping JSON', () => {
  it('every file in shipping/ is a valid ShippingPolicy named after its merchant', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(V1.length);
    for (const f of files) {
      const policy = ShippingPolicy.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      expect(`${policy.merchantId}.json`).toBe(f);
    }
  });

  it('loadShippingPolicies covers every v1 store and every file', () => {
    const ids = loadShippingPolicies().map((p) => p.merchantId);
    for (const id of V1) expect(ids).toContain(id);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(ids.length).toBe(files.length);
  });

  it('option ids are unique per store, and unknown fees are explained in notes', () => {
    for (const p of loadShippingPolicies()) {
      const optionIds = p.options.map((o) => o.id);
      expect(new Set(optionIds).size, p.merchantId).toBe(optionIds.length);
      expect(p.notes, p.merchantId).toBeTruthy();
    }
  });

  it('matches the researched thresholds', () => {
    const freeFrom = (id: Parameters<typeof getShippingPolicy>[0]) =>
      getShippingPolicy(id)!.options.find((o) => o.kind === 'pickup-point')?.freeFrom;
    expect(getShippingPolicy('apotea')!.options.every((o) => o.fee === 0)).toBe(true);
    expect(freeFrom('doz')).toBe(199);
    expect(freeFrom('hjartat')).toBe(299);
    expect(freeFrom('apoteket')).toBe(300);
    expect(freeFrom('lyko')).toBe(300);
    expect(freeFrom('gymgrossisten')).toBe(499);
  });
});

describe('isStale', () => {
  const p = { lastVerified: '2026-10-21' };
  it('is fresh up to 90 days, stale after', () => {
    expect(isStale(p, '2026-10-21')).toBe(false);
    expect(isStale(p, '2027-01-19')).toBe(false); // 90 days
    expect(isStale(p, '2027-01-20')).toBe(true); // 91 days
    expect(isStale(p, new Date('2027-06-01T12:00:00Z'))).toBe(true);
  });
});
