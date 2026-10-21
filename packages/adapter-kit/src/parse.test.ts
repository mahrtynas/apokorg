import { describe, expect, it } from 'vitest';
import {
  computeUnitPrice,
  isValidEan,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
} from './parse';

describe('parsePrice', () => {
  it.each([
    ['1 299,00 kr', 1299],
    ['1\u00a0299,00\u00a0kr', 1299],
    ['49:-', 49],
    ['129,90', 129.9],
    ['1.299 kr', 1299],
    ['Pris: 39,5 kr', 39.5],
    [99.5, 99.5],
  ])('%s → %s', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it('returns undefined without digits', () => {
    expect(parsePrice('slut i lager')).toBeUndefined();
    expect(parsePrice(undefined)).toBeUndefined();
  });
});

describe('parseSize', () => {
  it.each([
    ['Nivea Creme 150 ml', { value: 150, unit: 'ml' }],
    ['Whey-80 1,5 kg Choklad', { value: 1.5, unit: 'kg' }],
    ['Vatten 33cl', { value: 330, unit: 'ml' }],
    ['Proteinbar 60g', { value: 60, unit: 'g' }],
  ])('%s', (title, expected) => {
    expect(parseSize(title)).toEqual(expected);
  });

  it('ignores titles without size', () => {
    expect(parseSize('Alvedon 500 mg 20 st')).toBeUndefined();
  });
});

describe('parsePackCount', () => {
  it.each([
    ['Alvedon 500 mg 20 st', 20],
    ['Ipren 200 mg 30 tabletter', 30],
    ['Omega-3 120 kapslar', 120],
    ['Proteinbar 12-pack', 12],
    ['Nocco 24 x 330 ml', 24],
  ])('%s → %s', (title, expected) => {
    expect(parsePackCount(title)).toBe(expected);
  });
});

describe('EAN', () => {
  it('validates check digits', () => {
    // From a DOZ image filename, see docs/stores/doz.md.
    expect(isValidEan('7046264457757')).toBe(true);
    expect(isValidEan('7310100000004')).toBe(false);
    expect(isValidEan('4006381333931')).toBe(true);
    expect(isValidEan('73513537')).toBe(true);
    expect(isValidEan('abc')).toBe(false);
  });

  it('normalizes GTIN-14 with leading zero', () => {
    expect(normalizeEan('04006381333931')).toBe('4006381333931');
    expect(normalizeEan('4006 3813 3393 1')).toBe('4006381333931');
    expect(normalizeEan('4006381333932')).toBeUndefined();
  });
});

describe('computeUnitPrice', () => {
  it('per litre and per piece', () => {
    expect(computeUnitPrice(75, { value: 250, unit: 'ml' }, undefined)).toEqual({
      value: 300,
      per: 'l',
    });
    expect(computeUnitPrice(39, undefined, 20)).toEqual({ value: 1.95, per: 'st' });
    expect(computeUnitPrice(299, { value: 330, unit: 'ml' }, 24)).toEqual({
      value: 37.75,
      per: 'l',
    });
  });
});
