import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProbeResult } from '@apokorg/core';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, MIGRATIONS, openDataDb, openDb } from './db';
import { PROBE_TTL_MS, Repo, queryKey } from './repo';

describe('db', () => {
  it('migrates a new file once and reopens it without re-running migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apokorg-db-'));
    try {
      const db = openDataDb(dir);
      new Repo(db).putBasket('b1', 'Test', []);
      db.close();
      const again = openDataDb(dir);
      expect(again.prepare('PRAGMA user_version').get()).toEqual({
        user_version: MIGRATIONS.length,
      });
      expect(new Repo(again).getBasket('b1')?.name).toBe('Test');
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('picks the data dir from APOKORG_DATA_DIR, then APPDATA', () => {
    expect(defaultDataDir({ APOKORG_DATA_DIR: '/x', APPDATA: '/y' })).toBe('/x');
    expect(defaultDataDir({ APPDATA: '/y' })).toBe(join('/y', 'apokorg'));
  });
});

describe('repo', () => {
  it('normalizes query keys', () => {
    expect(queryKey('  Alvedon   500 ')).toBe('alvedon 500');
  });

  it('caches probe results per order-value band for 24 h', () => {
    let now = 0;
    const repo = new Repo(openDb(':memory:'), { now: () => now });
    const result: ProbeResult = {
      merchantId: 'apotea',
      orderValue: 250,
      postcode: '11738',
      options: [{ id: 'home', name: 'Hem', kind: 'home', fee: 39 }],
      probedAt: new Date(0).toISOString(),
      status: 'ok',
    };
    repo.cacheProbe(result);
    expect(repo.getCachedProbe('apotea', '11738', 299)).toEqual(result);
    expect(repo.getCachedProbe('apotea', '11738', 300)).toBeNull();
    now = PROBE_TTL_MS;
    expect(repo.getCachedProbe('apotea', '11738', 250)).toBeNull();
  });

  it('stores confirmed matches per query and store', () => {
    const repo = new Repo(openDb(':memory:'));
    repo.confirmMatch('Alvedon 20', 'apotea', 'a1');
    repo.confirmMatch('alvedon 20', 'apotea', 'a2');
    repo.confirmMatch('alvedon 20', 'doz', 'd1');
    expect(repo.getConfirmedMatches('ALVEDON 20')).toEqual({ apotea: 'a2', doz: 'd1' });
  });
});
