import { z } from 'zod';
import { MerchantId } from './merchants';

export const DeliveryKind = z.enum([
  'pickup-point',
  'store-pickup',
  'parcel-box',
  'mailbox',
  'home',
]);
export type DeliveryKind = z.infer<typeof DeliveryKind>;

/** One way to get an order delivered. The fee applies while the order value is below freeFrom. */
export const DeliveryOption = z.object({
  id: z.string(),
  name: z.string(),
  kind: DeliveryKind,
  fee: z.number().nonnegative(),
  /** Order value (SEK) from which this option is free. */
  freeFrom: z.number().nonnegative().optional(),
  /** The option is only offered from this order value. */
  minOrder: z.number().nonnegative().optional(),
});
export type DeliveryOption = z.infer<typeof DeliveryOption>;

/** Hand-maintained per store in packages/optimizer/shipping/<id>.json. */
export const ShippingPolicy = z.object({
  merchantId: MerchantId,
  options: z.array(DeliveryOption).min(1),
  /** Date the rule was last checked by a person or a probe. The UI warns after 90 days. */
  lastVerified: z.iso.date(),
  source: z.string().optional(),
  notes: z.string().optional(),
});
export type ShippingPolicy = z.infer<typeof ShippingPolicy>;

/**
 * cheapest             – cheapest option that ships the order: pickup point, parcel box, mailbox or home
 * home-only            – home delivery only
 * include-store-pickup – like cheapest, but collecting the order in a physical store also counts
 */
export const DeliveryPreference = z.enum(['cheapest', 'home-only', 'include-store-pickup']);
export type DeliveryPreference = z.infer<typeof DeliveryPreference>;

/** Result of a checkout probe for one store and order value. */
export const ProbeResult = z.object({
  merchantId: MerchantId,
  orderValue: z.number().nonnegative(),
  postcode: z.string(),
  options: z.array(DeliveryOption),
  probedAt: z.iso.datetime(),
  status: z.enum(['ok', 'unsupported', 'failed']),
  message: z.string().optional(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;
