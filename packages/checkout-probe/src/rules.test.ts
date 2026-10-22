import { describe, expect, it } from 'vitest';
import { blockedRequest, forbiddenField, matchDenylist, normalize, paymentProvider } from './rules';

describe('normalize', () => {
  it('folds case, diacritics, camelCase and punctuation', () => {
    expect(normalize('Slutför köp')).toBe('slutfor kop');
    expect(normalize('SLUTFÖR-KÖP')).toBe('slutfor kop');
    expect(normalize('placeOrder')).toBe('place order');
    expect(normalize('Lägg order!')).toBe('lagg order');
  });
});

describe('matchDenylist', () => {
  it.each([
    'Slutför köp',
    'Slutföra',
    'Betala 199 kr',
    'Betalas med kort',
    'Lägg ordern',
    'Bekräfta köp',
    'Köp nu',
    'Genomför köp',
    'Skicka order',
    'Place Order',
    'Pay',
    'Payment',
    'Confirm purchase',
    'Complete purchase',
    'Checkout with PayPal',
    'checkout/place-order',
  ])('matches "%s"', (text) => {
    expect(matchDenylist(text)).not.toBeNull();
  });

  it.each([
    'Fortsätt',
    'Lägg i varukorg',
    'Köp',
    'Till kassan',
    'Uppdatera',
    'Display',
    'Repay',
    'Välj leveranssätt',
  ])('allows "%s"', (text) => {
    expect(matchDenylist(text)).toBeNull();
  });
});

describe('forbiddenField', () => {
  const field = (descriptors: string[], type = 'text') => ({ tag: 'input', type, descriptors });

  it('allows postcode and email fields, address words included', () => {
    expect(forbiddenField(field(['postcode', 'Postnummer']))).toBeNull();
    expect(forbiddenField(field(['checkout[shipping_address][zip]', 'postal-code']))).toBeNull();
    expect(forbiddenField(field(['email', 'E-postadress'], 'email'))).toBeNull();
    expect(forbiddenField(field(['Email address']))).toBeNull();
  });

  it.each([
    [['personnummer'], 'personal number'],
    [['Personnr (ÅÅÅÅMMDDXXXX)'], 'personal number'],
    [['national_id'], 'personal number'],
    [['cc-number'], 'card'],
    [['Kortnummer'], 'card'],
    [['cc-exp'], 'card'],
    [['CVC'], 'cvc'],
    [['Säkerhetskod'], 'cvc'],
    [['tel'], 'phone'],
    [['Telefonnummer'], 'phone'],
    [['given-name'], 'name'],
    [['Förnamn'], 'name'],
    [['street-address'], 'address'],
    [['Adress'], 'address'],
    [['address-level2', 'Ort'], 'address'],
    [['Lösenord'], 'password'],
  ])('refuses %j as a %s field', (descriptors, kind) => {
    expect(forbiddenField(field(descriptors))).toBe(`${kind} field`);
  });

  it('refuses by input type', () => {
    expect(forbiddenField(field(['x'], 'password'))).toBe('password field');
    expect(forbiddenField(field(['x'], 'tel'))).toBe('phone field');
  });
});

describe('paymentProvider', () => {
  it('recognises provider frames by URL, name or id', () => {
    expect(paymentProvider('https://js.klarna.com/kco/checkout')).toBe('klarna');
    expect(paymentProvider('', 'walley-checkout-iframe')).toBe('walley');
    expect(paymentProvider('https://checkoutshopper-live.adyen.com/x')).toBe('adyen');
    expect(paymentProvider('https://pay.qliro.com/')).toBe('qliro');
    expect(paymentProvider('https://checkout.dibspayment.eu/')).toBe('dibspayment');
    expect(paymentProvider('https://www.cabinets.se/')).toBeNull();
  });
});

describe('blockedRequest', () => {
  it.each([
    ['https://www.apotea.se/checkout/place-order', 'POST'],
    ['https://www.apotea.se/api/placeOrder', 'POST'],
    ['https://www.apotea.se/order/confirm', 'GET'],
    ['https://www.lyko.com/sv/kassa/slutför', 'GET'],
    ['https://www.doz.se/api/orders', 'POST'],
    ['https://api.stripe.com/v1/payment_intents', 'POST'],
    ['https://api.stripe.com/v1/tokens', 'POST'],
    ['https://checkout-live.adyen.com/v71/payments', 'POST'],
    ['https://js.klarna.com/eu/kco/orders/1/authorize', 'POST'],
    ['https://checkout.svea.com/api/orders/1/complete', 'POST'],
    ['https://api.walleypay.com/checkout/purchase', 'POST'],
    ['https://pay.qliro.com/checkout/placeorder', 'POST'],
    ['https://api.dibspayment.eu/v1/payments', 'POST'],
  ])('blocks %s %s', (url, method) => {
    expect(blockedRequest(url, method)).not.toBeNull();
  });

  it.each([
    ['https://www.apotea.se/checkout', 'GET'],
    ['https://www.apotea.se/api/cart', 'POST'],
    ['https://www.apotea.se/orders', 'GET'],
    ['https://js.klarna.com/web-sdk/v1/klarna.js', 'GET'],
    ['https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/5.0/adyen.js', 'GET'],
  ])('allows %s %s', (url, method) => {
    expect(blockedRequest(url, method)).toBeNull();
  });
});
