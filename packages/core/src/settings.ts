import { z } from 'zod';
import { MerchantId } from './merchants';
import { DeliveryPreference } from './shipping';

export const Settings = z.object({
  enabledMerchants: z.array(MerchantId),
  memberOf: z.array(MerchantId).default([]),
  maxMerchants: z.number().int().positive().optional(),
  delivery: DeliveryPreference.default('cheapest'),
  /** Used by the checkout probe only. */
  postcode: z
    .string()
    .regex(/^\d{3}\s?\d{2}$/)
    .default('11738'),
  /** Used by the checkout probe only. A plus-address is recommended. */
  probeEmail: z.email().optional(),
  probeEnabled: z.boolean().default(true),
  /**
   * Optional. Matching works without it. Stored locally only.
   * GET returns it masked (`****` + last 4 characters, see `maskApiKey`). On PUT, an absent or
   * still-masked value keeps the stored key, and `""` clears it.
   */
  anthropicApiKey: z.string().optional(),
});
export type Settings = z.infer<typeof Settings>;

export const MASKED_API_KEY_PREFIX = '****';

/** How the server shows a stored API key: `****wxyz`. */
export function maskApiKey(key: string): string {
  return MASKED_API_KEY_PREFIX + key.slice(-4);
}

/** true when a PUT sends the masked form back, which means "keep the stored key". */
export function isMaskedApiKey(value: string): boolean {
  return value.startsWith(MASKED_API_KEY_PREFIX);
}
