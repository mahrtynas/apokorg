import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultCatalog } from './catalog';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('defaultCatalog', () => {
  it('reports empty, stale catalogs before the first refresh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apokorg-catalog-'));
    dirs.push(dir);
    const catalog = defaultCatalog(dir);
    expect(catalog.status()).toEqual([
      { merchantId: 'apotea', productCount: 0, refreshing: false },
      { merchantId: 'doz', productCount: 0, refreshing: false },
      { merchantId: 'gymgrossisten', productCount: 0, refreshing: false },
    ]);
    expect(catalog.isStale('apotea')).toBe(true);
    catalog.close?.();
  });
});
