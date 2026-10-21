/**
 * Fake adapters for building the matcher, optimizer, server and UI before real scrapers
 * exist. Data comes from fixtures/catalog.json (made-up prices, restricted-range EANs).
 */
import type { MerchantAdapter, MerchantId, ProductOffer, Size } from '@apokorg/core';
import { computeUnitPrice } from '@apokorg/adapter-kit';
import catalog from '../fixtures/catalog.json' with { type: 'json' };

interface CatalogProduct {
  id: string;
  brand: string;
  title: string;
  ean: string;
  size?: Size;
  packCount?: number;
  offers: Partial<Record<MerchantId, { price: number; inStock: boolean }>>;
}

const products = catalog.products as CatalogProduct[];

/** Merchants that have at least one product in the mock catalog. */
export const MOCK_MERCHANTS: MerchantId[] = [
  ...new Set(products.flatMap((p) => Object.keys(p.offers) as MerchantId[])),
];

export interface MockOptions {
  /** Simulated latency per call. Default 0. */
  latencyMs?: number;
  /** Throw on every search, to exercise error handling. */
  fail?: boolean;
}

function toOffer(p: CatalogProduct, merchantId: MerchantId): ProductOffer | null {
  const o = p.offers[merchantId];
  if (!o) return null;
  return {
    merchantId,
    merchantProductId: `${merchantId}-${p.id}`,
    title: p.title,
    brand: p.brand,
    ean: p.ean,
    size: p.size,
    packCount: p.packCount,
    price: o.price,
    unitPrice: computeUnitPrice(o.price, p.size, p.packCount),
    inStock: o.inStock,
    url: `https://example.com/${merchantId}/${p.id}`,
    fetchedAt: new Date().toISOString(),
  };
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** A fake adapter that pretends to be `merchantId`, serving that merchant's mock offers. */
export function createMockAdapter(merchantId: MerchantId, opts: MockOptions = {}): MerchantAdapter {
  const delay = () => new Promise((r) => setTimeout(r, opts.latencyMs ?? 0));
  return {
    info: {
      id: merchantId,
      name: `${merchantId} (mock)`,
      baseUrl: `https://example.com/${merchantId}`,
      category:
        merchantId === 'gymgrossisten' ? 'sport' : merchantId === 'lyko' ? 'beauty' : 'pharmacy',
      searchStrategy: 'api',
    },
    async search(query, searchOpts) {
      await delay();
      if (opts.fail) throw new Error(`mock ${merchantId} failure`);
      const q = tokens(query);
      return products
        .map((p) => ({
          p,
          score: q.filter((t) => tokens(p.title).some((w) => w.startsWith(t))).length,
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => toOffer(x.p, merchantId))
        .filter((o): o is ProductOffer => o !== null)
        .slice(0, searchOpts?.limit ?? 10);
    },
    async getProduct(url) {
      await delay();
      const id = url.split('/').pop();
      const p = products.find((x) => x.id === id);
      return p ? toOffer(p, merchantId) : null;
    },
  };
}

/** One mock adapter per merchant in the catalog. */
export function createMockAdapters(opts?: MockOptions): MerchantAdapter[] {
  return MOCK_MERCHANTS.map((id) => createMockAdapter(id, opts));
}

export default createMockAdapter('mock');
