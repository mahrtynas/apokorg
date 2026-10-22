import { z } from 'zod';
import { MerchantId } from './merchants';

export const SizeUnit = z.enum(['ml', 'l', 'g', 'kg', 'st']);
export type SizeUnit = z.infer<typeof SizeUnit>;

export const Size = z.object({
  value: z.number().positive(),
  unit: SizeUnit,
});
export type Size = z.infer<typeof Size>;

/** One product as sold by one merchant at one moment. Prices are SEK incl. VAT. */
export const ProductOffer = z.object({
  merchantId: MerchantId,
  /** The merchant's own product id or SKU, stable across fetches. */
  merchantProductId: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  /** EAN/GTIN, digits only, check digit validated. */
  ean: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional(),
  /** Size of the container, e.g. a 250 ml bottle is { value: 250, unit: 'ml' }. */
  size: Size.optional(),
  /** Number of items in the pack, e.g. 20 tablets. */
  packCount: z.number().int().positive().optional(),
  price: z.number().nonnegative(),
  /** Price before a campaign, when the merchant shows one. */
  originalPrice: z.number().nonnegative().optional(),
  /** Club/member price. Only used when the user marks themselves a member. */
  memberPrice: z.number().nonnegative().optional(),
  /** Multi-buy deal: "3 for 99 kr" is { qty: 3, unitPrice: 33 }. `price` stays the single-item price. */
  multiBuy: z
    .object({ qty: z.number().int().min(2), unitPrice: z.number().nonnegative() })
    .optional(),
  /** Last day of a campaign price, when the merchant shows one. Useful for cache expiry. */
  priceValidUntil: z.iso.date().optional(),
  /** Price per base unit (kr/l, kr/kg, kr/st) when it can be computed. */
  unitPrice: z
    .object({ value: z.number().nonnegative(), per: z.enum(['l', 'kg', 'st']) })
    .optional(),
  inStock: z.boolean(),
  url: z.url(),
  imageUrl: z.url().optional(),
  fetchedAt: z.iso.datetime(),
});
export type ProductOffer = z.infer<typeof ProductOffer>;

/**
 * exact       – same EAN, or same brand + product + size + pack with high confidence
 * equivalent  – the same product listed differently, same size and pack
 * substitute  – different pack size, brand or variant; compared by unit price
 */
export const MatchKind = z.enum(['exact', 'equivalent', 'substitute']);
export type MatchKind = z.infer<typeof MatchKind>;

export const MatchResult = z.object({
  offer: ProductOffer,
  kind: MatchKind,
  /** 0..1 */
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([]),
});
export type MatchResult = z.infer<typeof MatchResult>;
