import { z } from 'zod';

/** Every merchant the app knows about: v1 stores, then Phase 2 stores. */
export const MERCHANT_IDS = [
  'apotea',
  'hjartat',
  'apoteket',
  'doz',
  'kronans',
  'gymgrossisten',
  'lyko',
  'meds',
  // Phase 2
  'bangerhead',
  'kicks',
  'mmsports',
  'svensktkosttillskott',
  // Development only
  'mock',
] as const;

export const MerchantId = z.enum(MERCHANT_IDS);
export type MerchantId = z.infer<typeof MerchantId>;

export const MerchantCategory = z.enum(['pharmacy', 'beauty', 'sport']);
export type MerchantCategory = z.infer<typeof MerchantCategory>;

/** How an adapter finds products. See docs/stores/<id>.md for the details per store. */
export const SearchStrategy = z.enum(['api', 'search-page', 'catalog-index']);
export type SearchStrategy = z.infer<typeof SearchStrategy>;

export const MerchantInfo = z.object({
  id: MerchantId,
  name: z.string(),
  baseUrl: z.url(),
  category: MerchantCategory,
  searchStrategy: SearchStrategy,
});
export type MerchantInfo = z.infer<typeof MerchantInfo>;
