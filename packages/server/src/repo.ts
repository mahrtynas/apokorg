/** Typed access to the tables in db.ts. Everything read back is re-validated with zod. */
import { Basket, BasketItem, MerchantId, ProbeResult, ProductOffer, Settings } from '@apokorg/core';
import { z } from 'zod';
import type { Db } from './db';

export const OFFER_TTL_MS = 6 * 60 * 60 * 1000;
export const PROBE_TTL_MS = 24 * 60 * 60 * 1000;
/** Probe results are cached per 100 kr order-value band. */
export const PROBE_BAND_SEK = 100;

/** Cache and memory keys ignore case and extra whitespace. */
export function queryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

const SETTINGS_KEY = 'settings';

export interface RepoOptions {
  now?: () => number;
}

export class Repo {
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    opts: RepoOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  // ---- baskets ----

  listBaskets(): Basket[] {
    const rows = this.db
      .prepare('SELECT id, name, items_json, updated_at FROM baskets ORDER BY updated_at DESC')
      .all() as unknown as BasketRow[];
    return rows.map(rowToBasket);
  }

  getBasket(id: string): Basket | null {
    const row = this.db
      .prepare('SELECT id, name, items_json, updated_at FROM baskets WHERE id = ?')
      .get(id) as unknown as BasketRow | undefined;
    return row ? rowToBasket(row) : null;
  }

  putBasket(id: string, name: string, items: BasketItem[]): Basket {
    const basket = Basket.parse({
      id,
      name,
      items,
      updatedAt: new Date(this.now()).toISOString(),
    });
    this.db
      .prepare(
        `INSERT INTO baskets (id, name, items_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, items_json = excluded.items_json,
           updated_at = excluded.updated_at`,
      )
      .run(basket.id, basket.name, JSON.stringify(basket.items), basket.updatedAt);
    return basket;
  }

  deleteBasket(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM baskets WHERE id = ?').run(id).changes) > 0;
  }

  // ---- settings ----

  /** The stored settings, or null on first run. Includes the raw API key: never log this. */
  getSettings(): Settings | null {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) return null;
    const parsed = Settings.safeParse(JSON.parse(row.value_json));
    return parsed.success ? parsed.data : null;
  }

  saveSettings(settings: Settings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      )
      .run(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ---- confirmed matches ----

  /** The user's remembered picks for a query: merchantId → merchantProductId. */
  getConfirmedMatches(query: string): Partial<Record<MerchantId, string>> {
    const rows = this.db
      .prepare('SELECT merchant_id, merchant_product_id FROM confirmed_matches WHERE query_key = ?')
      .all(queryKey(query)) as unknown as { merchant_id: string; merchant_product_id: string }[];
    const out: Partial<Record<MerchantId, string>> = {};
    for (const r of rows) {
      const id = MerchantId.safeParse(r.merchant_id);
      if (id.success) out[id.data] = r.merchant_product_id;
    }
    return out;
  }

  confirmMatch(query: string, merchantId: MerchantId, merchantProductId: string): void {
    this.db
      .prepare(
        `INSERT INTO confirmed_matches (query_key, merchant_id, merchant_product_id, confirmed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(query_key, merchant_id) DO UPDATE SET
           merchant_product_id = excluded.merchant_product_id, confirmed_at = excluded.confirmed_at`,
      )
      .run(queryKey(query), merchantId, merchantProductId, new Date(this.now()).toISOString());
  }

  // ---- offer cache (TTL 6 h) ----

  getCachedOffers(merchantId: MerchantId, query: string): ProductOffer[] | null {
    const row = this.db
      .prepare(
        'SELECT offers_json, fetched_at FROM offer_cache WHERE merchant_id = ? AND query_key = ?',
      )
      .get(merchantId, queryKey(query)) as { offers_json: string; fetched_at: number } | undefined;
    if (!row || this.now() - Number(row.fetched_at) >= OFFER_TTL_MS) return null;
    const parsed = z.array(ProductOffer).safeParse(JSON.parse(row.offers_json));
    return parsed.success ? parsed.data : null;
  }

  cacheOffers(merchantId: MerchantId, query: string, offers: ProductOffer[]): void {
    this.db
      .prepare(
        `INSERT INTO offer_cache (merchant_id, query_key, offers_json, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(merchant_id, query_key) DO UPDATE SET
           offers_json = excluded.offers_json, fetched_at = excluded.fetched_at`,
      )
      .run(merchantId, queryKey(query), JSON.stringify(offers), this.now());
  }

  // ---- probe cache (TTL 24 h, per order-value band) ----

  getCachedProbe(merchantId: MerchantId, postcode: string, orderValue: number): ProbeResult | null {
    const row = this.db
      .prepare(
        `SELECT result_json, probed_at FROM probe_cache
         WHERE merchant_id = ? AND postcode = ? AND order_band = ?`,
      )
      .get(merchantId, postcode, probeBand(orderValue)) as
      { result_json: string; probed_at: number } | undefined;
    if (!row || this.now() - Number(row.probed_at) >= PROBE_TTL_MS) return null;
    const parsed = ProbeResult.safeParse(JSON.parse(row.result_json));
    return parsed.success ? parsed.data : null;
  }

  cacheProbe(result: ProbeResult): void {
    this.db
      .prepare(
        `INSERT INTO probe_cache (merchant_id, postcode, order_band, result_json, probed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(merchant_id, postcode, order_band) DO UPDATE SET
           result_json = excluded.result_json, probed_at = excluded.probed_at`,
      )
      .run(
        result.merchantId,
        result.postcode,
        probeBand(result.orderValue),
        JSON.stringify(result),
        this.now(),
      );
  }

  /** Deletes expired cache rows. */
  purgeExpired(): void {
    const now = this.now();
    this.db.prepare('DELETE FROM offer_cache WHERE fetched_at <= ?').run(now - OFFER_TTL_MS);
    this.db.prepare('DELETE FROM probe_cache WHERE probed_at <= ?').run(now - PROBE_TTL_MS);
  }
}

export function probeBand(orderValue: number): number {
  return Math.floor(orderValue / PROBE_BAND_SEK);
}

interface BasketRow {
  id: string;
  name: string;
  items_json: string;
  updated_at: string;
}

function rowToBasket(row: BasketRow): Basket {
  return Basket.parse({
    id: row.id,
    name: row.name,
    items: JSON.parse(row.items_json),
    updatedAt: row.updated_at,
  });
}
