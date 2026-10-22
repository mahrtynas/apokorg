/**
 * The catalog lives in its own SQLite file, `catalog.db`, next to the server's `apokorg.db`.
 * Uses Node's built-in `node:sqlite` like packages/server: no native addon, so it bundles into
 * the desktop sidecar. Products are indexed with FTS5 (external content on `products`).
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type CatalogDb = DatabaseSync;

/**
 * Default data directory: %APPDATA%/apokorg on Windows, XDG data home elsewhere.
 * Same rules as `defaultDataDir` in packages/server/src/db.ts; copied rather than imported
 * because the server depends on this package.
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APOKORG_DATA_DIR) return env.APOKORG_DATA_DIR;
  if (env.APPDATA) return join(env.APPDATA, 'apokorg');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'apokorg');
}

/** Ordered schema migrations. Never edit a shipped entry; append a new one instead. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    url         TEXT NOT NULL,
    title       TEXT NOT NULL,
    search_text TEXT NOT NULL,
    lastmod     TEXT,
    sitemap     TEXT NOT NULL,
    UNIQUE (merchant_id, url)
  );
  CREATE INDEX products_sitemap ON products (merchant_id, sitemap);
  CREATE VIRTUAL TABLE products_fts USING fts5(
    search_text,
    content = 'products',
    content_rowid = 'id',
    tokenize = "unicode61 tokenchars '.'"
  );
  CREATE TRIGGER products_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts (rowid, search_text) VALUES (new.id, new.search_text);
  END;
  CREATE TRIGGER products_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts (products_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
  END;
  CREATE TRIGGER products_au AFTER UPDATE ON products BEGIN
    INSERT INTO products_fts (products_fts, rowid, search_text) VALUES ('delete', old.id, old.search_text);
    INSERT INTO products_fts (rowid, search_text) VALUES (new.id, new.search_text);
  END;
  CREATE TABLE sitemaps (
    merchant_id TEXT NOT NULL,
    url         TEXT NOT NULL,
    lastmod     TEXT,
    PRIMARY KEY (merchant_id, url)
  );
  CREATE TABLE refreshes (
    merchant_id   TEXT PRIMARY KEY,
    refreshed_at  INTEGER NOT NULL,
    product_count INTEGER NOT NULL
  );
  `,
];

/** Opens (creating if needed) a catalog database file, or an in-memory one for ':memory:'. */
export function openCatalogDb(file: string = defaultCatalogPath()): CatalogDb {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

/** `<dataDir>/catalog.db`. */
export function defaultCatalogPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, 'catalog.db');
}

export function migrate(db: CatalogDb): void {
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

let shared: CatalogDb | undefined;

/** The process-wide catalog database at the default path, opened on first use. */
export function sharedCatalogDb(): CatalogDb {
  shared ??= openCatalogDb();
  return shared;
}
