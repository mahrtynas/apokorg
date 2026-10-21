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
  /** Optional. Matching works without it. Stored locally only. */
  anthropicApiKey: z.string().optional(),
});
export type Settings = z.infer<typeof Settings>;
