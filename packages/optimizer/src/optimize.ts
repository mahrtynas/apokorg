import {
  OptimizeOptions,
  type Assignment,
  type DeliveryOption,
  type DeliveryPreference,
  type ItemCandidates,
  type MatchResult,
  type MerchantId,
  type MerchantTotal,
  type ProbeResult,
  type ProductOffer,
  type ShippingPolicy,
  type SplitResult,
} from '@apokorg/core';
import { solveBinaryProgram, type BinaryProgram, type Constraint } from './milp';
import { fallbackShippingPolicy } from './shipping';

/** Tie-breakers, far below one öre so they never change which split is cheapest. */
const EPS_PER_MERCHANT = 0.001;
const EPS_SUBSTITUTE = 0.0001;
const EPS_CONFIDENCE = 0.0001;

interface Offer {
  item: number;
  store: number;
  match: MatchResult;
  unitPrice: number;
  lineTotal: number;
}

interface Store {
  merchantId: MerchantId;
  options: DeliveryOption[];
  probeVerified: boolean;
}

interface Problem {
  items: ItemCandidates[];
  offers: Offer[];
  stores: Store[];
}

interface Solution {
  /** Chosen offer index per item, or undefined when the item is left unsupplied. */
  chosen: (number | undefined)[];
  /** Chosen delivery option per used store index. */
  delivery: Map<number, DeliveryOption>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Shipping cost of one option at an order value. */
export function shippingFee(option: DeliveryOption, orderValue: number): number {
  return option.freeFrom !== undefined && orderValue >= option.freeFrom ? 0 : option.fee;
}

/**
 * Applies a successful checkout probe to a store's JSON options. The probe's options replace
 * the JSON ones. A probed fee is only known at the probed order value, so when the probe gives
 * no threshold of its own, the JSON threshold for the same option (by id, else by kind) is kept
 * as long as the probed order value was below it; otherwise the probe shows the threshold is
 * wrong and it is dropped.
 */
export function applyProbe(options: DeliveryOption[], probe: ProbeResult): DeliveryOption[] {
  return probe.options.map((po) => {
    if (po.freeFrom !== undefined || po.fee === 0) return po;
    const rule = options.find((o) => o.id === po.id) ?? options.find((o) => o.kind === po.kind);
    if (rule?.freeFrom !== undefined && probe.orderValue < rule.freeFrom) {
      return { ...po, freeFrom: rule.freeFrom };
    }
    return po;
  });
}

function latestProbes(overrides: ProbeResult[]): Map<MerchantId, ProbeResult> {
  const out = new Map<MerchantId, ProbeResult>();
  for (const p of overrides) {
    if (p.status !== 'ok' || p.options.length === 0) continue;
    const prev = out.get(p.merchantId);
    if (!prev || p.probedAt > prev.probedAt) out.set(p.merchantId, p);
  }
  return out;
}

function buildProblem(
  candidates: ItemCandidates[],
  policies: ShippingPolicy[],
  options: OptimizeOptions,
  overrides: ProbeResult[],
): Problem {
  const excluded = new Set(options.excludedMerchants);
  const members = new Set(options.memberOf);
  const probes = latestProbes(overrides);
  const policyById = new Map(policies.map((p) => [p.merchantId, p]));

  const stores: Store[] = [];
  const storeIndex = new Map<MerchantId, number>();
  const getStore = (merchantId: MerchantId): number | undefined => {
    const known = storeIndex.get(merchantId);
    if (known !== undefined) return known;
    const policy = policyById.get(merchantId) ?? fallbackShippingPolicy(merchantId);
    const probe = probes.get(merchantId);
    let opts = probe ? applyProbe(policy.options, probe) : policy.options;
    opts = opts.filter((o) => allowedDelivery(o, options.delivery));
    if (opts.length === 0) {
      storeIndex.set(merchantId, -1);
      return undefined;
    }
    storeIndex.set(merchantId, stores.length);
    stores.push({ merchantId, options: opts, probeVerified: probe !== undefined });
    return stores.length - 1;
  };

  const offers: Offer[] = [];
  candidates.forEach((item, i) => {
    for (const match of item.matches) {
      const { offer } = match;
      if (!offer.inStock) continue;
      if (match.kind === 'substitute' && !item.acceptSubstitutes) continue;
      if (excluded.has(offer.merchantId)) continue;
      const store = getStore(offer.merchantId);
      if (store === undefined || store < 0) continue;
      const unitPrice =
        members.has(offer.merchantId) && offer.memberPrice !== undefined
          ? Math.min(offer.memberPrice, offer.price)
          : offer.price;
      const lineTotal = round2(lineCost(unitPrice, item.qty, offer.multiBuy));
      offers.push({ item: i, store, match, unitPrice, lineTotal });
    }
  });

  return { items: candidates, offers, stores };
}

/** Store pickup means travelling to a shop, so only `include-store-pickup` counts it. */
function allowedDelivery(o: DeliveryOption, preference: DeliveryPreference): boolean {
  if (preference === 'home-only') return o.kind === 'home';
  if (preference === 'cheapest') return o.kind !== 'store-pickup';
  return true;
}

/**
 * Cost of `qty` items. A multi-buy deal ("3 for 99 kr") applies to each full set, the rest pay
 * the single price. A member price below the deal price still wins.
 */
function lineCost(unitPrice: number, qty: number, multiBuy: ProductOffer['multiBuy']): number {
  if (!multiBuy || multiBuy.unitPrice >= unitPrice) return unitPrice * qty;
  const sets = Math.floor(qty / multiBuy.qty);
  return sets * multiBuy.qty * multiBuy.unitPrice + (qty - sets * multiBuy.qty) * unitPrice;
}

/**
 * Integer program (all variables binary):
 *   x{k}      offer k supplies its item
 *   u{i}      item i is left unsupplied (penalised so heavily that it only happens when no
 *             allowed offer can be used, e.g. under maxMerchants)
 *   s{j}      store j is used
 *   y{j}_{o}  store j ships with option o
 *   f{j}_{o}  store j pays option o's fee (only for options with a freeFrom threshold)
 *
 *   sum_k x{k} + u{i} = 1                          each item once
 *   sum_{k of item i at j} x{k} <= s{j}            offers only from used stores
 *   sum_o y{j}_{o} = s{j}                          a used store picks one option
 *   subtotal_j >= T * (y - f),  f <= y             fee waived only if subtotal >= freeFrom T
 *   subtotal_j >= M * y                            option needs minOrder M
 *   sum_j s{j} <= maxMerchants
 *
 * The threshold row is the big-M linearisation with M = T, which is the tightest valid choice
 * since the subtotal is never negative.
 */
async function solve(problem: Problem, maxMerchants?: number): Promise<Solution> {
  const { items, offers, stores } = problem;
  const objective = new Map<string, number>();
  const constraints: Constraint[] = [];

  const penalty =
    1000 +
    offers.reduce((sum, o) => sum + o.lineTotal, 0) +
    stores.reduce((sum, s) => sum + Math.max(...s.options.map((o) => o.fee)), 0);

  const offersByItem = items.map(() => [] as number[]);
  offers.forEach((o, k) => {
    offersByItem[o.item]!.push(k);
    const tieBreak =
      (o.match.kind === 'substitute' ? EPS_SUBSTITUTE : 0) +
      (1 - o.match.confidence) * EPS_CONFIDENCE;
    objective.set(`x${k}`, o.lineTotal + tieBreak);
  });

  offersByItem.forEach((ks, i) => {
    if (ks.length === 0) return;
    objective.set(`u${i}`, penalty);
    constraints.push({
      terms: [...ks.map((k): [string, number] => [`x${k}`, 1]), [`u${i}`, 1]],
      op: '=',
      rhs: 1,
    });
    const byStore = new Map<number, number[]>();
    for (const k of ks) {
      const j = offers[k]!.store;
      byStore.set(j, [...(byStore.get(j) ?? []), k]);
    }
    for (const [j, storeKs] of byStore) {
      constraints.push({
        terms: [...storeKs.map((k): [string, number] => [`x${k}`, 1]), [`s${j}`, -1]],
        op: '<=',
        rhs: 0,
      });
    }
  });

  const usedStores = new Set(offers.map((o) => o.store));
  for (const j of usedStores) {
    const store = stores[j]!;
    objective.set(`s${j}`, EPS_PER_MERCHANT);
    const subtotal: [string, number][] = [];
    offers.forEach((o, k) => {
      if (o.store === j) subtotal.push([`x${k}`, o.lineTotal]);
    });
    constraints.push({
      terms: [...store.options.map((_, o): [string, number] => [`y${j}_${o}`, 1]), [`s${j}`, -1]],
      op: '=',
      rhs: 0,
    });
    store.options.forEach((opt, o) => {
      const y = `y${j}_${o}`;
      const threshold = opt.freeFrom ?? 0;
      if (opt.fee > 0 && threshold > 0) {
        const f = `f${j}_${o}`;
        objective.set(y, 0);
        objective.set(f, opt.fee);
        constraints.push({
          terms: [...subtotal, [y, -threshold], [f, threshold]],
          op: '>=',
          rhs: 0,
        });
        constraints.push({
          terms: [
            [f, 1],
            [y, -1],
          ],
          op: '<=',
          rhs: 0,
        });
      } else {
        objective.set(y, opt.freeFrom === 0 ? 0 : opt.fee);
      }
      if (opt.minOrder !== undefined && opt.minOrder > 0) {
        constraints.push({ terms: [...subtotal, [y, -opt.minOrder]], op: '>=', rhs: 0 });
      }
    });
  }

  if (maxMerchants !== undefined && usedStores.size > maxMerchants) {
    constraints.push({
      terms: [...usedStores].map((j) => [`s${j}`, 1]),
      op: '<=',
      rhs: maxMerchants,
    });
  }

  const chosen: (number | undefined)[] = items.map(() => undefined);
  const delivery = new Map<number, DeliveryOption>();
  if (offers.length === 0) return { chosen, delivery };

  const values = await solveBinaryProgram({ objective, constraints } satisfies BinaryProgram);
  offers.forEach((o, k) => {
    if (values.get(`x${k}`) === 1) chosen[o.item] = k;
  });
  for (const j of usedStores) {
    if (values.get(`s${j}`) !== 1) continue;
    stores[j]!.options.forEach((opt, o) => {
      if (values.get(`y${j}_${o}`) === 1) delivery.set(j, opt);
    });
  }
  return { chosen, delivery };
}

function toResult(problem: Problem, solution: Solution): SplitResult {
  const { items, offers, stores } = problem;
  const assignments: Assignment[] = [];
  const unavailableItemIds: string[] = [];
  const subtotals = new Map<number, number>();

  items.forEach((item, i) => {
    const k = solution.chosen[i];
    if (k === undefined) {
      unavailableItemIds.push(item.itemId);
      return;
    }
    const o = offers[k]!;
    assignments.push({
      itemId: item.itemId,
      merchantId: o.match.offer.merchantId,
      offer: o.match.offer,
      kind: o.match.kind,
      qty: item.qty,
      lineTotal: o.lineTotal,
    });
    subtotals.set(o.store, round2((subtotals.get(o.store) ?? 0) + o.lineTotal));
  });

  const perMerchant: MerchantTotal[] = [...subtotals].map(([j, subtotal]) => {
    const store = stores[j]!;
    const delivery = solution.delivery.get(j) ?? cheapestOption(store.options, subtotal);
    return {
      merchantId: store.merchantId,
      subtotal,
      shipping: shippingFee(delivery, subtotal),
      delivery,
      probeVerified: store.probeVerified,
    };
  });
  const total = round2(perMerchant.reduce((sum, m) => sum + m.subtotal + m.shipping, 0));
  return { assignments, perMerchant, total, unavailableItemIds };
}

function cheapestOption(options: DeliveryOption[], subtotal: number): DeliveryOption {
  const feasible = options.filter((o) => (o.minOrder ?? 0) <= subtotal);
  const pool = feasible.length > 0 ? feasible : options;
  return pool.reduce((best, o) =>
    shippingFee(o, subtotal) < shippingFee(best, subtotal) ? o : best,
  );
}

/**
 * Finds the cheapest assignment of basket items to stores, delivery fees included.
 *
 * - Out-of-stock offers are never used; substitutes only when the item accepts them.
 * - memberPrice is used for stores in `options.memberOf`.
 * - `delivery: 'home-only'` keeps only home delivery options; `'cheapest'` leaves out store
 *   pickup, which `'include-store-pickup'` allows.
 * - Multi-buy deals apply to each full set of items.
 * - `overrides` (checkout probe results) replace a store's JSON options; see applyProbe.
 * - Items that cannot be supplied are listed in `unavailableItemIds`; the rest still solve.
 */
export async function optimize(
  candidates: ItemCandidates[],
  policies: ShippingPolicy[],
  options: OptimizeOptions | Partial<OptimizeOptions> = {},
  overrides: ProbeResult[] = [],
): Promise<SplitResult> {
  const opts = OptimizeOptions.parse(options);
  const problem = buildProblem(candidates, policies, opts, overrides);
  const result = toResult(problem, await solve(problem, opts.maxMerchants));

  // Best single store: the cheapest store that can supply every item that any store can.
  const suppliable = new Set(problem.offers.map((o) => o.item));
  let best: { merchantId: MerchantId; total: number } | undefined;
  for (let j = 0; j < problem.stores.length; j++) {
    const storeOffers = problem.offers.filter((o) => o.store === j);
    if (new Set(storeOffers.map((o) => o.item)).size < suppliable.size) continue;
    const single: Problem = { ...problem, offers: storeOffers };
    const r = toResult(single, await solve(single));
    // A minOrder the store cannot reach leaves items unsupplied.
    if (r.unavailableItemIds.length > problem.items.length - suppliable.size) continue;
    if (!best || r.total < best.total)
      best = { merchantId: problem.stores[j]!.merchantId, total: r.total };
  }
  if (best) {
    result.bestSingleMerchant = best;
    result.savingsVsBestSingle = round2(best.total - result.total);
  }
  return result;
}
