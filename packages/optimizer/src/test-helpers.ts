import type {
  DeliveryOption,
  ItemCandidates,
  MatchKind,
  MatchResult,
  MerchantId,
  ShippingPolicy,
} from '@apokorg/core';

export interface OfferSpec {
  merchantId: MerchantId;
  price: number;
  memberPrice?: number;
  multiBuy?: { qty: number; unitPrice: number };
  inStock?: boolean;
  kind?: MatchKind;
}

export function match(itemId: string, spec: OfferSpec): MatchResult {
  return {
    offer: {
      merchantId: spec.merchantId,
      merchantProductId: `${spec.merchantId}-${itemId}-${spec.kind ?? 'exact'}`,
      title: `${itemId} at ${spec.merchantId}`,
      price: spec.price,
      ...(spec.memberPrice !== undefined ? { memberPrice: spec.memberPrice } : {}),
      ...(spec.multiBuy ? { multiBuy: spec.multiBuy } : {}),
      inStock: spec.inStock ?? true,
      url: `https://example.com/${spec.merchantId}/${itemId}`,
      fetchedAt: '2026-10-21T00:00:00Z',
    },
    kind: spec.kind ?? 'exact',
    confidence: 1,
    reasons: [],
  };
}

export function item(
  itemId: string,
  offers: OfferSpec[],
  opts: { qty?: number; acceptSubstitutes?: boolean } = {},
): ItemCandidates {
  return {
    itemId,
    qty: opts.qty ?? 1,
    acceptSubstitutes: opts.acceptSubstitutes ?? false,
    matches: offers.map((o) => match(itemId, o)),
  };
}

export function policy(merchantId: MerchantId, options: DeliveryOption[]): ShippingPolicy {
  return { merchantId, options, lastVerified: '2026-10-21' };
}

export const pickup = (fee: number, freeFrom?: number, extra: Partial<DeliveryOption> = {}) =>
  ({
    id: 'pickup',
    name: 'Ombud',
    kind: 'pickup-point',
    fee,
    ...(freeFrom !== undefined ? { freeFrom } : {}),
    ...extra,
  }) satisfies DeliveryOption;

export const home = (fee: number, freeFrom?: number) =>
  ({
    id: 'home',
    name: 'Hem',
    kind: 'home',
    fee,
    ...(freeFrom !== undefined ? { freeFrom } : {}),
  }) satisfies DeliveryOption;
