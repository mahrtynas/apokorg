import brandData from './brands.json' with { type: 'json' };

/**
 * Text normalization used for matching only (never for display):
 * lowercase, no diacritics (å/ä/ö → a/a/o), units glued to their numbers ("500 mg" → "500mg"),
 * pack words unified ("20 tabletter" → "20st") and brand aliases expanded ("lrp" → "la roche posay").
 */

const PACK_WORDS = [
  'st',
  'styck',
  'stycken',
  'tabletter',
  'tablett',
  'tabl',
  'tabs',
  'kapslar',
  'kapsel',
  'caps',
  'brustabletter',
  'sugtabletter',
  'dospasar',
  'pasar',
  'portioner',
  'plaster',
  'pack',
];

const UNIT_RE = new RegExp(
  `\\b(\\d+(?:\\.\\d+)?) ?(mg|ug|mcg|ie|iu|ml|cl|dl|l|liter|litre|g|gram|kg|${PACK_WORDS.join('|')})\\b`,
  'g',
);

const UNIT_CANON: Record<string, { unit: string; factor: number }> = {
  mg: { unit: 'mg', factor: 1 },
  ug: { unit: 'ug', factor: 1 },
  mcg: { unit: 'ug', factor: 1 },
  ie: { unit: 'ie', factor: 1 },
  iu: { unit: 'ie', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  dl: { unit: 'ml', factor: 100 },
  l: { unit: 'l', factor: 1 },
  liter: { unit: 'l', factor: 1 },
  litre: { unit: 'l', factor: 1 },
  g: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  kg: { unit: 'kg', factor: 1 },
};

/** Lowercase, strip diacritics and punctuation, glue units. No brand aliasing. */
export function normalizeBasic(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`´]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(UNIT_RE, (_m, num: string, rawUnit: string) => {
    const canon = UNIT_CANON[rawUnit];
    if (!canon) return `${num}st`;
    const value = Number(num) * canon.factor;
    return `${formatNumber(value)}${canon.unit}`;
  });
  return s.replace(/\bspf (\d+)\b/g, 'spf$1');
}

function formatNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

interface BrandData {
  brands: string[];
  aliases: Record<string, string>;
}

const data = brandData as BrandData;

/** Canonical brands, normalized. */
export const KNOWN_BRANDS: readonly string[] = [
  ...new Set([...data.brands, ...Object.values(data.aliases)].map(normalizeBasic)),
];

const ALIASES = new Map<string, string>();
for (const [alias, canonical] of Object.entries(data.aliases)) {
  ALIASES.set(normalizeBasic(alias), normalizeBasic(canonical));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Canonical names first in the alternation (when longer), so "loreal paris" is not
// re-expanded by the "loreal" alias.
const ALIAS_RE = new RegExp(
  `\\b(${[...new Set([...KNOWN_BRANDS, ...ALIASES.keys()])]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})\\b`,
  'g',
);

/** Full matching normalization: {@link normalizeBasic} plus brand aliases. */
export function normalize(text: string): string {
  return normalizeBasic(text).replace(ALIAS_RE, (m) => ALIASES.get(m) ?? m);
}

/** Words that carry no product identity: dosage forms, fillers, bare units. */
export const STOPWORDS = new Set([
  'och',
  'med',
  'for',
  'till',
  'av',
  'i',
  'pa',
  'mot',
  'x',
  'st',
  'mg',
  'ml',
  'g',
  'kg',
  'l',
  'filmdragerade',
  'filmdragerad',
  'tabletter',
  'tablett',
  'tabl',
  'kapslar',
  'kapsel',
  'caps',
  'pack',
  'styck',
  'stycken',
  'forpackning',
]);

/** A token that is a number glued to a unit, e.g. "500mg", "150ml", "20st". */
export const MEASURE_TOKEN_RE = /^\d+(?:\.\d+)?(?:mg|ug|ie|ml|l|g|kg|st)$/;

/** Splits normalized text into identity tokens (no stopwords, no measures). */
export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t && !STOPWORDS.has(t) && !MEASURE_TOKEN_RE.test(t));
}
