import { describe, expect, it } from 'vitest';
import { normalize, tokenize } from './normalize';
import { parseQuery } from './query';

const NBSP = String.fromCharCode(0xa0);

describe('normalize', () => {
  it.each([
    ['Möller’s Omega-3', 'mollers omega 3'],
    ['Åkerö ÄPPLE', 'akero apple'],
    ['500 mg', '500mg'],
    ['500mg', '500mg'],
    ['20 st', '20st'],
    ['20 tabletter', '20st'],
    ['20 tabl.', '20st'],
    ['60 kapslar', '60st'],
    ['3-pack', '3st'],
    ['1,5 kg', '1.5kg'],
    ['33 cl', '330ml'],
    ['2 dl', '200ml'],
    ['1000 µg', '1000ug'],
    ['400 mcg', '400ug'],
    ['SPF 50+', 'spf50'],
    ['LRP Anthelios', 'la roche posay anthelios'],
    ['La Roche-Posay', 'la roche posay'],
    ["L'Oréal Paris Revitalift", 'loreal paris revitalift'],
    ['Loreal revitalift', 'loreal paris revitalift'],
    [`Crème${NBSP}150${NBSP}ml`, 'creme 150ml'],
  ])('%s → %s', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it('tokenize drops measures and dosage-form words', () => {
    expect(tokenize(normalize('Alvedon 500 mg 20 st filmdragerade tabletter'))).toEqual([
      'alvedon',
    ]);
  });
});

describe('parseQuery', () => {
  it('parses brand, strength and pack', () => {
    expect(parseQuery('alvedon 500mg 20st')).toMatchObject({
      brand: 'alvedon',
      tokens: [],
      strength: { value: 500, unit: 'mg' },
      packCount: 20,
    });
  });

  it('keeps a bare number as a token', () => {
    const q = parseQuery('alvedon 500 20st');
    expect(q.tokens).toEqual(['500']);
    expect(q.strength).toBeUndefined();
    expect(q.packCount).toBe(20);
  });

  it('parses size and alias brand', () => {
    expect(parseQuery('LRP anthelios spf50 50 ml')).toMatchObject({
      brand: 'la roche posay',
      tokens: ['anthelios', 'spf50'],
      size: { value: 50, unit: 'ml' },
    });
  });

  it('recognises brands seen on offers', () => {
    expect(parseQuery('foobar kräm').brand).toBeUndefined();
    expect(parseQuery('foobar kräm', ['foobar']).brand).toBe('foobar');
  });

  it('recognises a bare EAN', () => {
    expect(parseQuery(' 4005808158126 ')).toMatchObject({ ean: '4005808158126', tokens: [] });
    expect(parseQuery('4005808158127').ean).toBeUndefined();
  });
});
