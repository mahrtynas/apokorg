/**
 * HTTP contract between apps/ui and packages/server. The server validates requests with
 * these schemas; the UI (and its mock handlers) builds against the same types.
 */
import { z } from 'zod';
import { Basket, BasketItem, OptimizeOptions, SplitResult } from './basket';
import { MerchantId, MerchantInfo } from './merchants';
import { MatchResult, ProductOffer, Size } from './product';
import { ShippingPolicy } from './shipping';
import { Settings } from './settings';

// GET /api/merchants
export const MerchantsResponse = z.object({
  merchants: z.array(
    MerchantInfo.extend({
      enabled: z.boolean(),
      shipping: ShippingPolicy.optional(),
      probeSupported: z.boolean(),
    }),
  ),
});
export type MerchantsResponse = z.infer<typeof MerchantsResponse>;

// PUT /api/merchants/:id/shipping: replaces the store's shipping rule and returns the stored one.
export const PutShippingRequest = ShippingPolicy;
export type PutShippingRequest = z.infer<typeof PutShippingRequest>;
export const PutShippingResponse = ShippingPolicy;
export type PutShippingResponse = z.infer<typeof PutShippingResponse>;

// POST /api/search
export const SearchRequest = z.object({
  query: z.string().min(1),
  merchants: z.array(MerchantId).optional(),
  acceptSubstitutes: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof SearchRequest>;

export const MerchantSearchStatus = z.object({
  merchantId: MerchantId,
  status: z.enum(['ok', 'timeout', 'error', 'unavailable']),
  message: z.string().optional(),
  tookMs: z.number(),
});
export type MerchantSearchStatus = z.infer<typeof MerchantSearchStatus>;

export const SearchResponse = z.object({
  query: z.string(),
  /** Best match per merchant first; then further candidates. */
  results: z.array(MatchResult),
  /** true when matching is uncertain and the user should pick. */
  needsConfirmation: z.boolean(),
  merchants: z.array(MerchantSearchStatus),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/**
 * One distinct product across stores: offers grouped by EAN, or by brand, name, strength,
 * size and pack when there is no EAN. Built by `groupProducts` in packages/matcher.
 */
export const ProductCandidate = z.object({
  key: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  ean: z.string().optional(),
  size: Size.optional(),
  packCount: z.number().int().positive().optional(),
  imageUrl: z.url().optional(),
  minPrice: z.number().nonnegative(),
  maxPrice: z.number().nonnegative(),
  merchantIds: z.array(MerchantId),
  offers: z.array(ProductOffer),
});
export type ProductCandidate = z.infer<typeof ProductCandidate>;

// POST /api/products/search: step 1 of adding an item, pick a product independent of store.
export const ProductSearchRequest = z.object({
  query: z.string().min(1),
  merchants: z.array(MerchantId).optional(),
});
export type ProductSearchRequest = z.infer<typeof ProductSearchRequest>;

export const ProductSearchResponse = z.object({
  query: z.string(),
  /** Most relevant first. */
  products: z.array(ProductCandidate),
  merchants: z.array(MerchantSearchStatus),
});
export type ProductSearchResponse = z.infer<typeof ProductSearchResponse>;

// POST /api/products/locate: step 2, find the chosen product at every store. Returns SearchResponse.
export const LocateRequest = z.object({
  /** The user's original query; searched again alongside the product's EAN. */
  query: z.string().min(1),
  product: z.object({ title: z.string(), ean: z.string().optional() }),
  merchants: z.array(MerchantId).optional(),
  acceptSubstitutes: z.boolean().default(false),
});
export type LocateRequest = z.infer<typeof LocateRequest>;

// GET /api/baskets, GET/PUT/DELETE /api/baskets/:id
export const BasketsResponse = z.object({ baskets: z.array(Basket) });
export type BasketsResponse = z.infer<typeof BasketsResponse>;

export const PutBasketRequest = z.object({
  name: z.string(),
  items: z.array(BasketItem),
});
export type PutBasketRequest = z.infer<typeof PutBasketRequest>;

/** PUT returns the saved basket. */
export const PutBasketResponse = Basket;
export type PutBasketResponse = z.infer<typeof PutBasketResponse>;

// POST /api/matches/confirm: remember that this store product is the right one for the query.
export const ConfirmMatchRequest = z.object({
  query: z.string().min(1),
  merchantId: MerchantId,
  merchantProductId: z.string().min(1),
});
export type ConfirmMatchRequest = z.infer<typeof ConfirmMatchRequest>;
export const ConfirmMatchResponse = z.object({ ok: z.literal(true) });
export type ConfirmMatchResponse = z.infer<typeof ConfirmMatchResponse>;

// POST /api/baskets/:id/optimize
export const OptimizeRequest = z.object({
  options: OptimizeOptions.optional(),
  /** Run checkout probes for the stores in the result (slower). */
  probe: z.boolean().default(false),
});
export type OptimizeRequest = z.infer<typeof OptimizeRequest>;

export const OptimizeResponse = z.object({
  split: SplitResult,
  /** Candidate matrix the split was computed from, for the comparison table. */
  candidates: z.array(
    z.object({
      itemId: z.string(),
      matches: z.array(MatchResult),
    }),
  ),
  merchants: z.array(MerchantSearchStatus),
});
export type OptimizeResponse = z.infer<typeof OptimizeResponse>;

// GET/PUT /api/settings. Responses mask the API key; see `Settings.anthropicApiKey`.
export const SettingsResponse = Settings;
export type SettingsResponse = z.infer<typeof SettingsResponse>;

// POST /api/catalog/refresh
export const CatalogRefreshRequest = z.object({ merchants: z.array(MerchantId).optional() });
export type CatalogRefreshRequest = z.infer<typeof CatalogRefreshRequest>;
/** 202: the refresh runs in the background. */
export const CatalogRefreshResponse = z.object({
  accepted: z.literal(true),
  merchants: z.array(MerchantId),
});
export type CatalogRefreshResponse = z.infer<typeof CatalogRefreshResponse>;

export const ApiError = z.object({ error: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiError>;
