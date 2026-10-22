import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_SOURCES } from '@apokorg/catalog-index';
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
    // Every catalog store is reported, so a new CATALOG_SOURCES entry doesn't break this test.
    expect(catalog.status()).toEqual(
      Object.keys(CATALOG_SOURCES).map((merchantId) => ({
        merchantId,
        productCount: 0,
        refreshing: false,
      })),
    );
    expect(catalog.isStale('apotea')).toBe(true);
    catalog.close?.();
  });
});
