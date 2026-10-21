import type { ProductOffer, Size } from '@apokorg/core';

/**
 * Parses Swedish-formatted prices: "1 299,00 kr", "49:-", "129,90", "1.299 kr", 99.5.
 * Returns undefined when no price can be found.
 */
export function parsePrice(input: string | number | null | undefined): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
  const s = input
    .replace(/[\s\u00a0\u202f]+/g, ' ')
    .replace(/kr|sek|:-/gi, '')
    .trim();
  const m = s.match(/\d[\d .]*(?:,\d{1,2})?/);
  if (!m) return undefined;
  let num = m[0].replace(/\s/g, '');
  if (num.includes(',')) {
    num = num.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}$/.test(num)) {
    // "1.299" is a thousands separator, not decimals.
    num = num.replace(/\./g, '');
  }
  const value = Number(num);
  return Number.isFinite(value) ? value : undefined;
}

const UNIT_ALIASES: Record<string, Size['unit']> = {
  ml: 'ml',
  cl: 'ml',
  dl: 'ml',
  l: 'l',
  liter: 'l',
  g: 'g',
  gr: 'g',
  gram: 'g',
  kg: 'kg',
};
const UNIT_FACTOR: Record<string, number> = { cl: 10, dl: 100 };

/** Finds a volume/weight in a title: "Nivea Creme 150 ml", "Whey 1,5 kg", "30cl". */
export function parseSize(title: string): Size | undefined {
  const re = /(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|liter|l|kg|gram|gr|g)\b/gi;
  let match: RegExpExecArray | null;
  let last: Size | undefined;
  while ((match = re.exec(title)) !== null) {
    const raw = match[2]!.toLowerCase();
    const unit = UNIT_ALIASES[raw];
    if (!unit) continue;
    const value = Number(match[1]!.replace(',', '.')) * (UNIT_FACTOR[raw] ?? 1);
    if (value > 0) last = { value, unit };
  }
  return last;
}

/** Finds a pack count: "20 st", "100 tabletter", "60 kapslar", "3-pack", "2 x 50 ml". */
export function parsePackCount(title: string): number | undefined {
  const re =
    /(\d+)\s*(?:st\b|styck|tabletter|tabl\b|tablett|kapslar|kapsel|caps\b|brustabletter|sugtabletter|dospåsar|påsar|portioner|plåster|-?pack\b)/i;
  const m = title.match(re);
  if (m) return Number(m[1]);
  const multi = title.match(/(\d+)\s*x\s*\d/i);
  return multi ? Number(multi[1]) : undefined;
}

/** Validates an EAN-8/UPC-A/EAN-13/GTIN-14 check digit. */
export function isValidEan(code: string | null | undefined): code is string {
  if (!code || !/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Normalizes an EAN candidate (strips spaces, pads GTIN-14 leading zero away) or returns undefined. */
export function normalizeEan(code: string | number | null | undefined): string | undefined {
  if (code == null) return undefined;
  let s = String(code).replace(/\D/g, '');
  if (s.length === 14 && s.startsWith('0')) s = s.slice(1);
  return isValidEan(s) ? s : undefined;
}

/** kr per l / kg / st, rounded to 2 decimals. */
export function computeUnitPrice(
  price: number,
  size: Size | undefined,
  packCount: number | undefined,
): ProductOffer['unitPrice'] {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (size) {
    const multiplier = packCount && packCount > 1 ? packCount : 1;
    switch (size.unit) {
      case 'ml':
        return { value: round(price / ((size.value * multiplier) / 1000)), per: 'l' };
      case 'l':
        return { value: round(price / (size.value * multiplier)), per: 'l' };
      case 'g':
        return { value: round(price / ((size.value * multiplier) / 1000)), per: 'kg' };
      case 'kg':
        return { value: round(price / (size.value * multiplier)), per: 'kg' };
      case 'st':
        return { value: round(price / size.value), per: 'st' };
    }
  }
  if (packCount) return { value: round(price / packCount), per: 'st' };
  return undefined;
}

/** Collapses whitespace and decodes the few HTML entities that show up in titles. */
export function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
