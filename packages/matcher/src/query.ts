import type { ProductOffer, Size } from '@apokorg/core';
import { normalizeEan, parsePackCount, parseSize } from '@apokorg/adapter-kit';
import { KNOWN_BRANDS, normalize, tokenize } from './normalize';

export interface Strength {
  value: number;
  /** mg, ug (micrograms) or ie (international units). */
  unit: 'mg' | 'ug' | 'ie';
}

export interface ParsedQuery {
  /** Normalized query text. */
  normalized: string;
  /** Canonical brand, normalized (e.g. "la roche posay"). */
  brand?: string;
  /** Identity tokens, without the brand, measures and stopwords. */
  tokens: string[];
  strength?: Strength;
  size?: Size;
  packCount?: number;
  /** Set when the whole query is a valid EAN. */
  ean?: string;
}

const STRENGTH_RE = /\b(\d+(?:\.\d+)?)(mg|ug|ie)\b/;
/** A leading bundle count in normalized text, as in "24 x nocco bcaa 330ml". */
const BUNDLE_RE = /^(\d+) x (?=\D)/;

/** Splits off a leading bundle count: "24 x nocco bcaa" → 24 and "nocco bcaa". */
function splitBundle(normalized: string): { count?: number; rest: string } {
  const m = BUNDLE_RE.exec(normalized);
  const count = m ? Number(m[1]) : 0;
  return count >= 2 ? { count, rest: normalized.slice(m![0].length) } : { rest: normalized };
}

/** Finds a brand phrase in normalized text, longest first. */
export function detectBrand(
  normalized: string,
  extraBrands: Iterable<string> = [],
): string | undefined {
  const padded = ` ${normalized} `;
  const candidates = [...new Set([...KNOWN_BRANDS, ...extraBrands])].filter(Boolean);
  candidates.sort((a, b) => b.length - a.length);
  return candidates.find((b) => padded.includes(` ${b} `));
}

function parseStrength(normalized: string): Strength | undefined {
  const m = normalized.match(STRENGTH_RE);
  if (!m) return undefined;
  return { value: Number(m[1]), unit: m[2] as Strength['unit'] };
}

function removeBrandTokens(tokens: string[], brand: string | undefined): string[] {
  if (!brand) return tokens;
  const brandTokens = new Set(brand.split(' '));
  return tokens.filter((t) => !brandTokens.has(t));
}

/**
 * Parses a user's rough query such as "alvedon 500 20st" or "LRP anthelios spf50 50 ml".
 * `extraBrands` (normalized) lets brands seen on the offers count as brands in the query.
 */
export function parseQuery(query: string, extraBrands: Iterable<string> = []): ParsedQuery {
  const trimmed = query.trim();
  const ean = /^\d[\d\s]{6,16}$/.test(trimmed) ? normalizeEan(trimmed) : undefined;
  const normalized = normalize(trimmed);
  const brand = ean ? undefined : detectBrand(normalized, extraBrands);
  const bundle = splitBundle(normalized);
  const parsed: ParsedQuery = {
    normalized,
    tokens: ean ? [] : removeBrandTokens(tokenize(bundle.rest), brand),
  };
  if (ean) parsed.ean = ean;
  if (brand) parsed.brand = brand;
  if (ean) return parsed;
  const strength = parseStrength(normalized);
  if (strength) parsed.strength = strength;
  const size = parseSize(trimmed);
  if (size) parsed.size = size;
  const packCount = parsePackCount(trimmed) ?? parsePackCount(normalized) ?? bundle.count;
  if (packCount) parsed.packCount = packCount;
  return parsed;
}

/** Matching features of one offer, computed once per call. */
export interface OfferFeatures {
  normalized: string;
  brand?: string;
  /** Identity tokens without the brand. */
  tokens: string[];
  strength?: Strength;
  size?: Size;
  packCount?: number;
}

export function offerFeatures(
  offer: ProductOffer,
  extraBrands: Iterable<string> = [],
): OfferFeatures {
  const normalized = normalize(offer.title);
  const brand = offer.brand ? normalize(offer.brand) : detectBrand(normalized, extraBrands);
  const bundle = splitBundle(normalized);
  const tokens = tokenize(bundle.rest);
  const f: OfferFeatures = {
    normalized,
    // Only strip the brand from the title when the title actually contains it.
    tokens:
      brand && ` ${normalized} `.includes(` ${brand} `) ? removeBrandTokens(tokens, brand) : tokens,
  };
  if (brand) f.brand = brand;
  const strength = parseStrength(normalized);
  if (strength) f.strength = strength;
  const size = offer.size ?? parseSize(offer.title);
  if (size) f.size = size;
  const packCount = offer.packCount ?? parsePackCount(offer.title) ?? bundle.count;
  if (packCount) f.packCount = packCount;
  return f;
}

/** Size in base units (ml, g or st) for comparison. */
export function baseSize(size: Size): { value: number; unit: 'ml' | 'g' | 'st' } {
  switch (size.unit) {
    case 'l':
      return { value: size.value * 1000, unit: 'ml' };
    case 'kg':
      return { value: size.value * 1000, unit: 'g' };
    default:
      return { value: size.value, unit: size.unit };
  }
}

export function sameSize(a: Size, b: Size): boolean {
  const x = baseSize(a);
  const y = baseSize(b);
  return x.unit === y.unit && Math.abs(x.value - y.value) <= Math.max(x.value, y.value) * 0.005;
}

export function formatSize(size: Size): string {
  return `${size.value} ${size.unit}`;
}
