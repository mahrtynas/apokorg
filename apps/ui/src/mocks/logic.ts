/**
 * Stand-ins for the server's matcher and optimizer, good enough to give every screen data.
 * Matching: the most common EAN among each store's top hit is the reference; same EAN is
 * "exact", anything else "substitute". Splitting: greedy cheapest store per item, then
 * merge away the smallest stores while over maxMerchants, then add each store's shipping.
 */
import { createMockAdapter } from '@apokorg/adapter-mock';
import type {
  api,
  Assignment,
  BasketItem,
  DeliveryOption,
  DeliveryPreference,
  MatchResult,
  MerchantId,
  MerchantTotal,
  OptimizeOptions,
  ProductOffer,
  ShippingPolicy,
  SplitResult,
} from '@apokorg/core';

type Status = api.MerchantSearchStatus;

export interface MerchantSearch {
  merchantId: MerchantId;
  offers: ProductOffer[];
  status: Status;
}

export async function searchMerchants(
  query: string,
  merchants: MerchantId[],
  failing: ReadonlySet<MerchantId> = new Set(),
): Promise<MerchantSearch[]> {
  return Promise.all(
    merchants.map(async (merchantId) => {
      const started = Date.now();
      try {
        const offers = await createMockAdapter(merchantId, {
          fail: failing.has(merchantId),
        }).search(query, { limit: 10 });
        return {
          merchantId,
          offers,
          status: { merchantId, status: 'ok' as const, tookMs: Date.now() - started },
        };
      } catch (e) {
        return {
          merchantId,
          offers: [],
          status: {
            merchantId,
            status: 'error' as const,
            message: e instanceof Error ? e.message : String(e),
            tookMs: Date.now() - started,
          },
        };
      }
    }),
  );
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** How many query words prefix a word in the title (the mock adapter's own ranking). */
function score(query: string, title: string): number {
  const words = tokens(title);
  return tokens(query).filter((q) => words.some((w) => w.startsWith(q))).length;
}

/**
 * The product the query most likely means: a pinned one, else the best-scoring title
 * (ties broken by how many stores sell it). `ambiguous` when another product scores the same.
 */
function referenceEan(
  query: string,
  searches: MerchantSearch[],
  pinnedEans: string[],
): { ean: string | undefined; ambiguous: boolean } {
  if (pinnedEans[0]) return { ean: pinnedEans[0], ambiguous: false };
  const products = new Map<string, { score: number; stores: number }>();
  for (const s of searches) {
    for (const o of s.offers) {
      if (!o.ean) continue;
      const p = products.get(o.ean) ?? { score: score(query, o.title), stores: 0 };
      p.stores += 1;
      products.set(o.ean, p);
    }
  }
  const ranked = [...products].sort((a, b) => b[1].score - a[1].score || b[1].stores - a[1].stores);
  const [first, second] = ranked;
  return { ean: first?.[0], ambiguous: !!second && second[1].score === first![1].score };
}

function toMatch(offer: ProductOffer, ref: string | undefined, pinned: boolean): MatchResult {
  if (pinned) return { offer, kind: 'exact', confidence: 1, reasons: ['Confirmed by you'] };
  if (ref && offer.ean === ref) {
    return { offer, kind: 'exact', confidence: 0.95, reasons: ['Same EAN'] };
  }
  return { offer, kind: 'substitute', confidence: 0.4, reasons: ['Different product'] };
}

export interface MatchedSearch {
  /** Per merchant, best match first. */
  byMerchant: Map<MerchantId, MatchResult[]>;
  needsConfirmation: boolean;
}

/** Labels offers per merchant against a reference product and orders best-first. */
export function matchSearches(
  query: string,
  searches: MerchantSearch[],
  pinned: BasketItem['pinned'] = {},
): MatchedSearch {
  const pinnedEans = searches.flatMap((s) => {
    const id = pinned[s.merchantId];
    const ean = s.offers.find((o) => o.merchantProductId === id)?.ean;
    return ean ? [ean] : [];
  });
  const { ean: ref, ambiguous } = referenceEan(query, searches, pinnedEans);
  const byMerchant = new Map<MerchantId, MatchResult[]>();
  for (const s of searches) {
    if (!s.offers.length) continue;
    const pinId = pinned[s.merchantId];
    const rank = (o: ProductOffer) =>
      o.merchantProductId === pinId ? 0 : ref && o.ean === ref ? 1 : 2;
    const sorted = [...s.offers].sort((a, b) => rank(a) - rank(b));
    byMerchant.set(
      s.merchantId,
      sorted.map((o) => toMatch(o, ref, o.merchantProductId === pinId)),
    );
  }
  // Uncertain when two different products fit the query equally well.
  return { byMerchant, needsConfirmation: ambiguous };
}

/** Flattens per-merchant matches into SearchResponse order: best per merchant, then the rest. */
export function flattenMatches(byMerchant: Map<MerchantId, MatchResult[]>): MatchResult[] {
  const lists = [...byMerchant.values()];
  return [...lists.flatMap((l) => l.slice(0, 1)), ...lists.flatMap((l) => l.slice(1))];
}

const FALLBACK_DELIVERY: DeliveryOption = {
  id: 'standard',
  name: 'Standard',
  kind: 'pickup-point',
  fee: 49,
};

export function chooseDelivery(
  policy: ShippingPolicy | undefined,
  subtotal: number,
  preference: DeliveryPreference,
): { delivery: DeliveryOption; shipping: number } {
  const options = (policy?.options ?? [FALLBACK_DELIVERY]).filter(
    (o) => (o.minOrder ?? 0) <= subtotal,
  );
  const home = options.filter((o) => o.kind === 'home');
  const pool = preference === 'home-only' && home.length ? home : options;
  const priced = (pool.length ? pool : [FALLBACK_DELIVERY]).map((o) => ({
    delivery: o,
    shipping: o.freeFrom !== undefined && subtotal >= o.freeFrom ? 0 : o.fee,
  }));
  priced.sort((a, b) => a.shipping - b.shipping);
  return priced[0]!;
}

export interface CandidateItem {
  item: BasketItem;
  matches: MatchResult[];
}

const effectivePrice = (o: ProductOffer, memberOf: MerchantId[]) =>
  memberOf.includes(o.merchantId) && o.memberPrice !== undefined ? o.memberPrice : o.price;

function allowedMatches(c: CandidateItem, opts: OptimizeOptions): MatchResult[] {
  return c.matches.filter(
    (m) =>
      m.offer.inStock &&
      !opts.excludedMerchants.includes(m.offer.merchantId) &&
      (m.kind !== 'substitute' || c.item.acceptSubstitutes),
  );
}

function cheapest(
  matches: MatchResult[],
  opts: OptimizeOptions,
  within?: ReadonlySet<MerchantId>,
): MatchResult | undefined {
  let best: MatchResult | undefined;
  for (const m of matches) {
    if (within && !within.has(m.offer.merchantId)) continue;
    if (!best || effectivePrice(m.offer, opts.memberOf) < effectivePrice(best.offer, opts.memberOf))
      best = m;
  }
  return best;
}

function totals(
  assignments: Assignment[],
  shipping: Map<MerchantId, ShippingPolicy>,
  preference: DeliveryPreference,
): MerchantTotal[] {
  const subtotals = new Map<MerchantId, number>();
  for (const a of assignments) {
    subtotals.set(a.merchantId, (subtotals.get(a.merchantId) ?? 0) + a.lineTotal);
  }
  return [...subtotals].map(([merchantId, subtotal]) => ({
    merchantId,
    subtotal,
    ...chooseDelivery(shipping.get(merchantId), subtotal, preference),
    probeVerified: false,
  }));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function greedySplit(
  candidates: CandidateItem[],
  options: OptimizeOptions,
  shipping: Map<MerchantId, ShippingPolicy>,
): SplitResult {
  const allowed = candidates.map((c) => ({ c, matches: allowedMatches(c, options) }));
  const pick = new Map<string, MatchResult>();
  const unavailable = new Set<string>();
  for (const { c, matches } of allowed) {
    const best = cheapest(matches, options);
    if (best) pick.set(c.item.id, best);
    else unavailable.add(c.item.id);
  }

  // Too many stores: move the items of the smallest store to the cheapest remaining one.
  const max = options.maxMerchants;
  if (max !== undefined) {
    for (;;) {
      const used = new Map<MerchantId, number>();
      for (const [itemId, m] of pick) {
        const qty = candidates.find((c) => c.item.id === itemId)!.item.qty;
        used.set(
          m.offer.merchantId,
          (used.get(m.offer.merchantId) ?? 0) + effectivePrice(m.offer, options.memberOf) * qty,
        );
      }
      if (used.size <= max) break;
      const smallest = [...used].sort((a, b) => a[1] - b[1])[0]![0];
      const remaining = new Set([...used.keys()].filter((id) => id !== smallest));
      for (const { c, matches } of allowed) {
        if (pick.get(c.item.id)?.offer.merchantId !== smallest) continue;
        const next = cheapest(matches, options, remaining);
        if (next) pick.set(c.item.id, next);
        else {
          pick.delete(c.item.id);
          unavailable.add(c.item.id);
        }
      }
    }
  }

  const assignments: Assignment[] = candidates.flatMap((c) => {
    const m = pick.get(c.item.id);
    if (!m) return [];
    return [
      {
        itemId: c.item.id,
        merchantId: m.offer.merchantId,
        offer: m.offer,
        kind: m.kind,
        qty: c.item.qty,
        lineTotal: round2(effectivePrice(m.offer, options.memberOf) * c.item.qty),
      },
    ];
  });
  const perMerchant = totals(assignments, shipping, options.delivery);
  const total = round2(sum(perMerchant.map((t) => t.subtotal + t.shipping)));

  // Best single store that can supply every item.
  let bestSingleMerchant: SplitResult['bestSingleMerchant'];
  const merchantIds = new Set(allowed.flatMap((a) => a.matches.map((m) => m.offer.merchantId)));
  for (const id of merchantIds) {
    const only = new Set([id]);
    const picks = allowed.map(({ c, matches }) => ({ c, m: cheapest(matches, options, only) }));
    if (picks.some((p) => !p.m)) continue;
    const subtotal = sum(
      picks.map((p) => effectivePrice(p.m!.offer, options.memberOf) * p.c.item.qty),
    );
    const t = round2(
      subtotal + chooseDelivery(shipping.get(id), subtotal, options.delivery).shipping,
    );
    if (!bestSingleMerchant || t < bestSingleMerchant.total) {
      bestSingleMerchant = { merchantId: id, total: t };
    }
  }

  return {
    assignments,
    perMerchant,
    total,
    unavailableItemIds: [...unavailable],
    bestSingleMerchant,
    savingsVsBestSingle: bestSingleMerchant ? round2(bestSingleMerchant.total - total) : undefined,
  };
}
