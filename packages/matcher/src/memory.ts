import type { BasketItem, MerchantId } from '@apokorg/core';
import { normalize } from './normalize';

/**
 * Confirmed matches, keyed by {@link queryKey} then merchant. Pure data: the server decides
 * where to store it.
 */
export type MatchMemory = Record<string, BasketItem['pinned']>;

/** Stable key for a query: normalized words, sorted, so "20st alvedon 500" = "Alvedon 500 20 st". */
export function queryKey(query: string): string {
  return [...new Set(normalize(query).split(' ').filter(Boolean))].sort().join(' ');
}

/** Returns a new memory with the user's choice for `query` at `merchantId` recorded. */
export function rememberChoice(
  memory: MatchMemory,
  query: string,
  merchantId: MerchantId,
  merchantProductId: string,
): MatchMemory {
  const key = queryKey(query);
  return { ...memory, [key]: { ...memory[key], [merchantId]: merchantProductId } };
}

/** Returns a new memory without the choice for `query` at `merchantId`. */
export function forgetChoice(
  memory: MatchMemory,
  query: string,
  merchantId: MerchantId,
): MatchMemory {
  const key = queryKey(query);
  const current = memory[key];
  if (!current || !(merchantId in current)) return memory;
  const rest = { ...current };
  delete rest[merchantId];
  const next = { ...memory };
  if (Object.keys(rest).length > 0) next[key] = rest;
  else delete next[key];
  return next;
}

/** The remembered choices for `query`, merged under the item's own pins (which win). */
export function recallPinned(
  memory: MatchMemory,
  query: string,
  pinned: BasketItem['pinned'] = {},
): BasketItem['pinned'] {
  return { ...memory[queryKey(query)], ...pinned };
}
