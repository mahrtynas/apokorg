/**
 * Optimizing goes through the `Optimizer` interface so packages/optimizer (task O) can replace
 * the placeholder below with a one-line change in deps.ts.
 */
import type {
  Assignment,
  DeliveryOption,
  ItemCandidates,
  MatchResult,
  MerchantId,
  MerchantTotal,
  OptimizeOptions,
  ProbeResult,
  ShippingPolicy,
  SplitResult,
} from '@apokorg/core';

export interface Optimizer {
  optimize(
    candidates: ItemCandidates[],
    policies: ShippingPolicy[],
    options: OptimizeOptions,
    overrides?: ProbeResult[],
  ): SplitResult | Promise<SplitResult>;
}

/** Supplies the shipping rules per merchant (packages/optimizer's `loadShippingPolicies`). */
export type ShippingPolicySource = (merchantIds: MerchantId[]) => ShippingPolicy[];

/**
 * Placeholder until packages/optimizer ships real per-store JSON: a flat, conservative
 * 49 kr home delivery for every store.
 */
export const placeholderShippingPolicies: ShippingPolicySource = (ids) =>
  ids.map((merchantId) => ({
    merchantId,
    options: [{ id: 'standard', name: 'Standard', kind: 'home', fee: 49 }],
    lastVerified: '2026-10-21',
    notes: 'Placeholder in packages/server until packages/optimizer lands.',
  }));

const unitPrice = (m: MatchResult, memberOf: MerchantId[]) =>
  memberOf.includes(m.offer.merchantId) && m.offer.memberPrice !== undefined
    ? m.offer.memberPrice
    : m.offer.price;

/** Same rule as packages/optimizer: store pickup only counts with 'include-store-pickup'. */
const allowedOption = (o: DeliveryOption, options: OptimizeOptions) =>
  options.delivery === 'home-only'
    ? o.kind === 'home'
    : options.delivery === 'include-store-pickup' || o.kind !== 'store-pickup';

const hasDelivery = (policy: ShippingPolicy | undefined, options: OptimizeOptions) =>
  !!policy && policy.options.some((o) => allowedOption(o, options));

/** Cheapest allowed delivery option for a subtotal, with its effective fee. */
function cheapestDelivery(
  policy: ShippingPolicy,
  subtotal: number,
  options: OptimizeOptions,
): { delivery: DeliveryOption; fee: number } | null {
  let best: { delivery: DeliveryOption; fee: number } | null = null;
  for (const o of policy.options) {
    if (!allowedOption(o, options)) continue;
    if (o.minOrder !== undefined && subtotal < o.minOrder) continue;
    const fee = o.freeFrom !== undefined && subtotal >= o.freeFrom ? 0 : o.fee;
    if (!best || fee < best.fee) best = { delivery: o, fee };
  }
  return best;
}

/**
 * Placeholder greedy optimizer: each item goes to its cheapest allowed offer, then each used
 * store's cheapest delivery option is added. With `maxMerchants`, only the stores that won
 * the most items are kept and the items are reassigned among them. Probe overrides replace a
 * store's options.
 */
export const placeholderOptimizer: Optimizer = {
  optimize(candidates, policies, options, overrides = []) {
    const policyFor = new Map<MerchantId, ShippingPolicy>(policies.map((p) => [p.merchantId, p]));
    for (const o of overrides) {
      const base = policyFor.get(o.merchantId);
      if (o.status === 'ok' && o.options.length > 0 && base) {
        policyFor.set(o.merchantId, { ...base, options: o.options });
      }
    }
    const excluded = new Set(options.excludedMerchants);
    const allowed = (c: ItemCandidates) =>
      c.matches.filter(
        (m) =>
          m.offer.inStock &&
          !excluded.has(m.offer.merchantId) &&
          (m.kind !== 'substitute' || c.acceptSubstitutes) &&
          hasDelivery(policyFor.get(m.offer.merchantId), options),
      );

    const assign = (onlyStores?: Set<MerchantId>) => {
      const assignments: Assignment[] = [];
      const unavailable: string[] = [];
      for (const c of candidates) {
        const pick = allowed(c)
          .filter((m) => !onlyStores || onlyStores.has(m.offer.merchantId))
          .sort((a, b) => unitPrice(a, options.memberOf) - unitPrice(b, options.memberOf))[0];
        if (!pick) {
          unavailable.push(c.itemId);
          continue;
        }
        assignments.push({
          itemId: c.itemId,
          merchantId: pick.offer.merchantId,
          offer: pick.offer,
          kind: pick.kind,
          qty: c.qty,
          lineTotal: round(unitPrice(pick, options.memberOf) * c.qty),
        });
      }
      return { assignments, unavailable };
    };

    const totals = (assignments: Assignment[]) => {
      const subtotals = new Map<MerchantId, number>();
      for (const a of assignments) {
        subtotals.set(a.merchantId, (subtotals.get(a.merchantId) ?? 0) + a.lineTotal);
      }
      const perMerchant: MerchantTotal[] = [];
      for (const [merchantId, subtotal] of subtotals) {
        const policy = policyFor.get(merchantId)!;
        // Below every option's minOrder: fall back to the first allowed option at full fee.
        const d = cheapestDelivery(policy, subtotal, options) ?? {
          delivery: policy.options.find((o) => allowedOption(o, options)) ?? policy.options[0]!,
          fee: Math.max(...policy.options.map((o) => o.fee)),
        };
        perMerchant.push({
          merchantId,
          subtotal: round(subtotal),
          shipping: d.fee,
          delivery: d.delivery,
          probeVerified: overrides.some((o) => o.merchantId === merchantId && o.status === 'ok'),
        });
      }
      const total = round(perMerchant.reduce((s, m) => s + m.subtotal + m.shipping, 0));
      return { perMerchant, total };
    };

    let { assignments, unavailable } = assign();
    const wins = new Map<MerchantId, number>();
    for (const a of assignments) wins.set(a.merchantId, (wins.get(a.merchantId) ?? 0) + 1);
    if (options.maxMerchants !== undefined && wins.size > options.maxMerchants) {
      const keep = [...wins.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, options.maxMerchants)
        .map(([id]) => id);
      ({ assignments, unavailable } = assign(new Set(keep)));
    }
    const { perMerchant, total } = totals(assignments);

    // Best single store: the cheapest store that can supply every item that is supplied at all.
    const suppliable = candidates.filter((c) => allowed(c).length > 0);
    const stores = new Set(suppliable.flatMap((c) => allowed(c).map((m) => m.offer.merchantId)));
    let bestSingleMerchant: SplitResult['bestSingleMerchant'];
    for (const store of stores) {
      const single = assign(new Set([store]));
      if (single.assignments.length !== suppliable.length) continue;
      const t = totals(single.assignments).total;
      if (!bestSingleMerchant || t < bestSingleMerchant.total) {
        bestSingleMerchant = { merchantId: store, total: t };
      }
    }

    return {
      assignments,
      perMerchant,
      total,
      unavailableItemIds: unavailable,
      bestSingleMerchant,
      savingsVsBestSingle: bestSingleMerchant ? round(bestSingleMerchant.total - total) : undefined,
    };
  },
};

const round = (n: number) => Math.round(n * 100) / 100;
