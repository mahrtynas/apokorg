/**
 * SQLite access. Uses Node's built-in `node:sqlite` (Node 22.13+/24) instead of
 * better-sqlite3: no native addon to build or prebuild, and it bundles cleanly into the
 * single-executable sidecar. The API is synchronous, like better-sqlite3.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/**
 * Ordered schema migrations. Never edit a shipped entry; append a new one instead.
 * `PRAGMA user_version` records how many have been applied.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE baskets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    items_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE TABLE confirmed_matches (
    query_key           TEXT NOT NULL,
    merchant_id         TEXT NOT NULL,
    merchant_product_id TEXT NOT NULL,
    confirmed_at        TEXT NOT NULL,
    PRIMARY KEY (query_key, merchant_id)
  );
  CREATE TABLE offer_cache (
    merchant_id TEXT NOT NULL,
    query_key   TEXT NOT NULL,
    offers_json TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,
    PRIMARY KEY (merchant_id, query_key)
  );
  CREATE TABLE probe_cache (
    merchant_id TEXT NOT NULL,
    postcode    TEXT NOT NULL,
    order_band  INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    probed_at   INTEGER NOT NULL,
    PRIMARY KEY (merchant_id, postcode, order_band)
  );
  `,
  `
  CREATE TABLE shipping_overrides (
    merchant_id TEXT PRIMARY KEY,
    policy_json TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE match_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    query               TEXT NOT NULL,
    query_key           TEXT NOT NULL,
    merchant_id         TEXT NOT NULL,
    merchant_product_id TEXT NOT NULL,
    offer_json          TEXT,
    accepted_at         TEXT NOT NULL
  );
  CREATE INDEX match_history_query ON match_history (query_key);
  `,
];

/** Default data directory: %APPDATA%/apokorg on Windows, XDG data home elsewhere. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APOKORG_DATA_DIR) return env.APOKORG_DATA_DIR;
  if (env.APPDATA) return join(env.APPDATA, 'apokorg');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'apokorg');
}

/** Opens (creating if needed) the database file, or an in-memory one for ':memory:'. */
export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

/** Opens `<dataDir>/apokorg.db`, creating the directory. */
export function openDataDb(dataDir: string = defaultDataDir()): Db {
  mkdirSync(dataDir, { recursive: true });
  return openDb(join(dataDir, 'apokorg.db'));
}

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
