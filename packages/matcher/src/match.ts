import type { BasketItem, MatchKind, MatchResult, MerchantId, ProductOffer } from '@apokorg/core';
import { normalize } from './normalize';
import {
  formatSize,
  offerFeatures,
  parseQuery,
  sameSize,
  baseSize,
  type OfferFeatures,
  type ParsedQuery,
} from './query';
import { LLM_MODEL, type JudgeDecision, type LlmJudge } from './llm';

export interface MatchOptions {
  /** Include `substitute` results. Default false. */
  acceptSubstitutes?: boolean;
  /** User-confirmed merchantProductId per merchant; always wins. */
  pinned?: BasketItem['pinned'];
  /** Optional tie-breaker for near-equal candidates at one store. */
  llm?: LlmJudge;
  /** Top two candidates closer than this count as ambiguous. Default 0.05. */
  ambiguityMargin?: number;
  /** Maximum substitutes kept per merchant. Default 5. */
  maxSubstitutesPerMerchant?: number;
}

/** Highest confidence an unresolved tie may keep, so the user is asked. */
const AMBIGUOUS_CAP = 0.79;
const EXACT_MIN = 0.8;
const KIND_RANK: Record<MatchKind, number> = { exact: 0, equivalent: 1, substitute: 2 };

interface Candidate {
  offer: ProductOffer;
  features: OfferFeatures;
  kind: MatchKind;
  confidence: number;
  reasons: string[];
  /** Key of the size/pack/strength the query left open, e.g. "ml:150|p:-". */
  openVariant?: string;
  locked?: boolean;
}

const clamp = (n: number) => Math.min(1, Math.max(0.01, Math.round(n * 1000) / 1000));

function capKind(kind: MatchKind, cap: MatchKind): MatchKind {
  return KIND_RANK[kind] >= KIND_RANK[cap] ? kind : cap;
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(q: string, offerTokens: string[]): string | undefined {
  for (const t of offerTokens) {
    if (t === q) return t;
  }
  for (const t of offerTokens) {
    if (q.length >= 4 && t.startsWith(q)) return t;
    if (q.length >= 5 && t.length >= 5 && levenshteinAtMostOne(q, t)) return t;
  }
  return undefined;
}

function numericMatchesMeasure(token: string, f: OfferFeatures): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(token)) return false;
  const n = Number(token);
  return (
    f.strength?.value === n ||
    f.packCount === n ||
    (f.size !== undefined && (f.size.value === n || baseSize(f.size).value === n))
  );
}

/** Scores one offer against the query. Returns undefined when it is not a candidate at all. */
export function scoreOffer(
  q: ParsedQuery,
  offer: ProductOffer,
  f: OfferFeatures,
): Candidate | undefined {
  const reasons: string[] = [];
  const base = { offer, features: f };

  if (q.ean) {
    if (offer.ean === q.ean) {
      return { ...base, kind: 'exact', confidence: 1, reasons: ['EAN matches the query'] };
    }
    return undefined;
  }

  // Brand
  if (q.brand) {
    const titleHasBrand = ` ${f.normalized} `.includes(` ${q.brand} `);
    if (f.brand ? f.brand !== q.brand : !titleHasBrand) return undefined;
    reasons.push('brand matches');
  }

  // Tokens
  const pool = q.brand ? f.tokens : [...(f.brand ? f.brand.split(' ') : []), ...f.tokens];
  const used = new Set<string>();
  const missing: string[] = [];
  let numericAsMeasure = false;
  // A bare number in the query ("alvedon 500") that is not on the listing is read as a strength.
  let impliedStrength: string | undefined;
  for (const t of q.tokens) {
    const hit = tokenMatches(t, pool);
    if (hit) used.add(hit);
    else if (numericMatchesMeasure(t, f)) numericAsMeasure = true;
    else if (!q.strength && f.strength && !impliedStrength && /^\d+(?:\.\d+)?$/.test(t)) {
      impliedStrength = t;
    } else missing.push(t);
  }
  const total = q.tokens.length;
  const matched = total - missing.length;
  const coverage = total === 0 ? 1 : matched / total;
  if (total > 0 && (matched === 0 || coverage < 0.5)) return undefined;
  if (!q.brand && total === 0) return undefined;

  let kind: MatchKind = 'exact';
  let confidence = 1;
  const open: string[] = [];

  if (!q.brand) {
    kind = capKind(kind, 'equivalent');
    confidence -= 0.1;
    reasons.push('query names no brand');
  }
  if (missing.length > 0) {
    kind = 'substitute';
    confidence *= coverage;
    reasons.push(`differs in: ${missing.join(', ')}`);
  } else if (total > 0) {
    reasons.push('all query words match');
  }
  const extras = f.tokens.filter((t) => !used.has(t));
  if (extras.length > 0) confidence -= Math.min(0.15, 0.03 * extras.length);

  // Strength (mg, µg, IE)
  if (q.strength) {
    if (!f.strength) {
      kind = capKind(kind, 'equivalent');
      confidence -= 0.1;
      reasons.push('strength not stated on listing');
    } else if (f.strength.unit !== q.strength.unit || f.strength.value !== q.strength.value) {
      kind = 'substitute';
      confidence -= 0.2;
      reasons.push(
        `strength ${f.strength.value} ${f.strength.unit} vs ${q.strength.value} ${q.strength.unit}`,
      );
    } else {
      reasons.push('strength matches');
    }
  } else if (f.strength && impliedStrength) {
    kind = 'substitute';
    confidence -= 0.2;
    reasons.push(`strength ${f.strength.value} ${f.strength.unit} vs ${impliedStrength}`);
  } else if (f.strength && !numericAsMeasure) {
    kind = capKind(kind, 'equivalent');
    confidence -= 0.05;
    open.push(`s:${f.strength.value}${f.strength.unit}`);
  }

  // Size
  if (q.size) {
    if (!f.size) {
      kind = capKind(kind, 'equivalent');
      confidence -= 0.1;
      reasons.push('size not stated on listing');
    } else if (!sameSize(q.size, f.size)) {
      kind = 'substitute';
      confidence -= 0.15;
      reasons.push(`size ${formatSize(f.size)} vs ${formatSize(q.size)}`);
    } else {
      reasons.push('size matches');
    }
  } else if (f.size) {
    kind = capKind(kind, 'equivalent');
    confidence -= 0.05;
    const b = baseSize(f.size);
    open.push(`${b.unit}:${b.value}`);
  }

  // Pack count
  if (q.packCount) {
    if (!f.packCount) {
      kind = capKind(kind, 'equivalent');
      confidence -= 0.1;
      reasons.push('pack count not stated on listing');
    } else if (f.packCount !== q.packCount) {
      kind = 'substitute';
      confidence -= 0.15;
      reasons.push(`pack of ${f.packCount} vs ${q.packCount}`);
    } else {
      reasons.push('pack count matches');
    }
  } else if (f.packCount) {
    kind = capKind(kind, 'equivalent');
    confidence -= 0.05;
    open.push(`p:${f.packCount}`);
  }

  confidence = clamp(confidence);
  if (kind === 'exact' && confidence < EXACT_MIN) kind = 'equivalent';
  const c: Candidate = { ...base, kind, confidence, reasons };
  if (open.length > 0 && kind !== 'substitute') c.openVariant = open.join('|');
  return c;
}

function demote(c: Candidate, reason: string, factor = 0.85) {
  c.kind = 'substitute';
  c.confidence = clamp(c.confidence * factor);
  c.reasons.push(reason);
}

const isPrimary = (c: Candidate) => c.kind !== 'substitute';

/** Groups by key, keeping first-seen order. */
function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Picks the group offered by the most merchants; undefined on a tie. */
function consensus<K>(groups: Map<K, Candidate[]>): K | undefined {
  let best: K | undefined;
  let bestScore = -1;
  let tie = false;
  for (const [k, cs] of groups) {
    const merchants = new Set(cs.map((c) => c.offer.merchantId)).size;
    const score = merchants * 1000 + cs.length;
    if (score > bestScore) {
      best = k;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }
  return tie ? undefined : best;
}

interface Prepared {
  query: string;
  candidates: Candidate[];
  /** Merchants whose top two primary candidates are near-tied, with those candidates. */
  ambiguous: Map<MerchantId, Candidate[]>;
  opts: Required<Omit<MatchOptions, 'llm' | 'pinned'>> & { pinned: BasketItem['pinned'] };
}

function prepare(query: string, offers: ProductOffer[], options: MatchOptions): Prepared {
  const opts = {
    acceptSubstitutes: options.acceptSubstitutes ?? false,
    pinned: options.pinned ?? {},
    ambiguityMargin: options.ambiguityMargin ?? 0.05,
    maxSubstitutesPerMerchant: options.maxSubstitutesPerMerchant ?? 5,
  };
  const offerBrands = new Set<string>();
  for (const o of offers) if (o.brand) offerBrands.add(normalize(o.brand));
  const q = parseQuery(query, offerBrands);

  const features = offers.map((o) => offerFeatures(o, offerBrands));
  const scored = new Map<ProductOffer, Candidate>();
  offers.forEach((o, i) => {
    const c = scoreOffer(q, o, features[i]!);
    if (c) scored.set(o, c);
  });

  // 1. Pinned: the user's confirmed product for that store always wins.
  const pinnedMerchants = new Set<MerchantId>();
  offers.forEach((o, i) => {
    if (opts.pinned[o.merchantId] !== o.merchantProductId) return;
    pinnedMerchants.add(o.merchantId);
    scored.set(o, {
      offer: o,
      features: features[i]!,
      kind: 'exact',
      confidence: 1,
      reasons: ['confirmed by you'],
      locked: true,
    });
  });

  let candidates = [...scored.values()];

  // 2. Query without a brand: the brand most stores carry is the product, others substitute.
  if (!q.brand && !q.ean) {
    const primaries = candidates.filter((c) => isPrimary(c) && !c.locked);
    const winner = consensus(groupBy(primaries, (c) => c.features.brand ?? ''));
    if (winner !== undefined) {
      for (const c of primaries) {
        if ((c.features.brand ?? '') !== winner) demote(c, 'other brand than the usual one');
      }
    }
  }

  // 3. Size/pack the query leaves open: the variant most stores carry is the product.
  const open = candidates.filter((c) => isPrimary(c) && !c.locked && c.openVariant);
  const winner = consensus(groupBy(open, (c) => c.openVariant));
  if (winner !== undefined) {
    for (const c of open) {
      if (c.openVariant !== winner) demote(c, 'other size or pack than the usual one');
    }
  }

  // 4. EAN: an exact match carries over to every offer with the same EAN.
  const exactEans = new Map<string, Candidate>();
  for (const c of candidates) {
    if (c.kind === 'exact' && c.confidence >= EXACT_MIN && c.offer.ean) {
      if (!exactEans.has(c.offer.ean)) exactEans.set(c.offer.ean, c);
    }
  }
  if (exactEans.size > 0) {
    offers.forEach((o, i) => {
      if (!o.ean || pinnedMerchants.has(o.merchantId)) return;
      const source = exactEans.get(o.ean);
      if (!source || source.offer === o) return;
      const existing = scored.get(o);
      if (existing?.kind === 'exact' && existing.confidence === 1) return;
      const c: Candidate = existing ?? {
        offer: o,
        features: features[i]!,
        kind: 'exact',
        confidence: 1,
        reasons: [],
      };
      c.kind = 'exact';
      c.confidence = 1;
      c.locked = true;
      c.reasons.push(`same EAN as ${source.offer.merchantId}`);
      if (!existing) scored.set(o, c);
    });
    candidates = [...scored.values()];
  }

  // 5. One primary per store; near-ties are ambiguous.
  const ambiguous = new Map<MerchantId, Candidate[]>();
  for (const [merchantId, cs] of groupBy(candidates, (c) => c.offer.merchantId)) {
    const primaries = cs.filter(isPrimary).sort((a, b) => b.confidence - a.confidence);
    if (primaries.length < 2) continue;
    // Pinned or EAN-confirmed listings win over scored ones.
    const locked = primaries.find((c) => c.locked);
    if (locked) {
      for (const c of primaries) if (c !== locked) demote(c, 'another listing is confirmed');
      continue;
    }
    const top = primaries[0]!;
    const close = primaries.filter((c) => top.confidence - c.confidence < opts.ambiguityMargin);
    if (close.length >= 2) ambiguous.set(merchantId, close);
    for (const c of primaries) {
      if (!close.includes(c)) demote(c, 'a closer match exists at this store');
    }
  }

  return { query, candidates, ambiguous, opts };
}

function resolve(p: Prepared, decisions: Map<MerchantId, JudgeDecision | undefined>) {
  for (const [merchantId, close] of p.ambiguous) {
    const decision = decisions.get(merchantId);
    if (decision) {
      const chosen = close.find((c) => c.offer.merchantProductId === decision.choice);
      for (const c of close) {
        if (c === chosen) {
          c.confidence = clamp(Math.max(c.confidence, decision.confidence));
          c.reasons.push(`picked by ${LLM_MODEL}: ${decision.reason}`);
        } else {
          demote(
            c,
            chosen
              ? `${LLM_MODEL} preferred another listing`
              : `rejected by ${LLM_MODEL}: ${decision.reason}`,
            0.7,
          );
        }
      }
      continue;
    }
    // No judge: keep the first (stable order), lower confidence so the user is asked.
    const [keep, ...rest] = close;
    keep!.confidence = Math.min(keep!.confidence, AMBIGUOUS_CAP);
    keep!.reasons.push(`ambiguous: ${close.length} similar listings at this store`);
    for (const c of rest) demote(c, 'ambiguous with another listing at this store');
  }

  const out: MatchResult[] = [];
  for (const cs of groupBy(p.candidates, (c) => c.offer.merchantId).values()) {
    cs.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.confidence - a.confidence);
    let subs = 0;
    for (const c of cs) {
      if (c.kind === 'substitute') {
        if (!p.opts.acceptSubstitutes || subs >= p.opts.maxSubstitutesPerMerchant) continue;
        subs++;
      }
      out.push({ offer: c.offer, kind: c.kind, confidence: c.confidence, reasons: c.reasons });
    }
  }
  return out;
}

function toJudgeRequest(query: string, merchantId: MerchantId, close: Candidate[]) {
  return {
    query,
    merchantId,
    candidates: close.map((c) => ({
      id: c.offer.merchantProductId,
      title: c.offer.title,
      ...(c.offer.brand ? { brand: c.offer.brand } : {}),
      ...(c.features.size ? { size: formatSize(c.features.size) } : {}),
      ...(c.features.packCount ? { packCount: c.features.packCount } : {}),
    })),
  };
}

/**
 * Matches without the LLM step. Results are grouped by merchant: at most one `exact` or
 * `equivalent` per merchant, then substitutes (only when accepted).
 */
export function matchOffersSync(
  query: string,
  offers: ProductOffer[],
  options: Omit<MatchOptions, 'llm'> = {},
): MatchResult[] {
  return resolve(prepare(query, offers, options), new Map());
}

/**
 * Decides which offers are the product the user means. When `llm` is given, near-ties at a
 * store are put to it; failures fall back to the heuristic result.
 */
export async function matchOffers(
  query: string,
  offers: ProductOffer[],
  options: MatchOptions = {},
): Promise<MatchResult[]> {
  const p = prepare(query, offers, options);
  const decisions = new Map<MerchantId, JudgeDecision | undefined>();
  const llm = options.llm;
  if (llm && p.ambiguous.size > 0) {
    await Promise.all(
      [...p.ambiguous].map(async ([merchantId, close]) => {
        try {
          decisions.set(merchantId, await llm.pick(toJudgeRequest(query, merchantId, close)));
        } catch {
          decisions.set(merchantId, undefined);
        }
      }),
    );
  }
  return resolve(p, decisions);
}

/** True when no store has an `exact` match with confidence ≥ 0.8, so the user should confirm. */
export function needsConfirmation(results: MatchResult[]): boolean {
  return !results.some((r) => r.kind === 'exact' && r.confidence >= EXACT_MIN);
}
