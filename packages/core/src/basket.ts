import { z } from 'zod';
import { MerchantId } from './merchants';
import { MatchKind, MatchResult, ProductOffer } from './product';
import { DeliveryOption, DeliveryPreference } from './shipping';

export const BasketItem = z.object({
  id: z.string(),
  /** What the user typed, e.g. "alvedon 500 20st". */
  query: z.string().min(1),
  qty: z.number().int().positive().default(1),
  acceptSubstitutes: z.boolean().default(false),
  /** User-confirmed merchantProductId per merchant. Overrides automatic matching. */
  pinned: z.partialRecord(MerchantId, z.string()).default({}),
});
export type BasketItem = z.infer<typeof BasketItem>;

export const Basket = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(BasketItem),
  updatedAt: z.iso.datetime(),
});
export type Basket = z.infer<typeof Basket>;

/** Candidate offers for one basket item across merchants, as fed to the optimizer. */
export const ItemCandidates = z.object({
  itemId: z.string(),
  qty: z.number().int().positive(),
  acceptSubstitutes: z.boolean(),
  matches: z.array(MatchResult),
});
export type ItemCandidates = z.infer<typeof ItemCandidates>;

export const OptimizeOptions = z.object({
  maxMerchants: z.number().int().positive().optional(),
  excludedMerchants: z.array(MerchantId).default([]),
  memberOf: z.array(MerchantId).default([]),
  delivery: DeliveryPreference.default('cheapest'),
});
export type OptimizeOptions = z.infer<typeof OptimizeOptions>;

export const Assignment = z.object({
  itemId: z.string(),
  merchantId: MerchantId,
  offer: ProductOffer,
  kind: MatchKind,
  qty: z.number().int().positive(),
  lineTotal: z.number().nonnegative(),
});
export type Assignment = z.infer<typeof Assignment>;

export const MerchantTotal = z.object({
  merchantId: MerchantId,
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  delivery: DeliveryOption,
  /** true when the fee came from a checkout probe rather than the JSON rule. */
  probeVerified: z.boolean().default(false),
});
export type MerchantTotal = z.infer<typeof MerchantTotal>;

export const SplitResult = z.object({
  assignments: z.array(Assignment),
  perMerchant: z.array(MerchantTotal),
  total: z.number().nonnegative(),
  /** Items no merchant could supply under the given options. */
  unavailableItemIds: z.array(z.string()),
  bestSingleMerchant: z
    .object({ merchantId: MerchantId, total: z.number().nonnegative() })
    .optional(),
  savingsVsBestSingle: z.number().optional(),
});
export type SplitResult = z.infer<typeof SplitResult>;
