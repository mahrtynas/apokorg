/**
 * The guard's rules as pure functions, so they can be unit-tested without a browser.
 * Every rule errs on the side of refusing: a probe that can't continue is fine, an order is not.
 */

/**
 * Lowercases, strips diacritics (ö → o), splits camelCase and turns anything that isn't a
 * letter or digit into single spaces. "Slutför köp", "SLUTFOR-KOP" and "slutförKöp" all
 * become "slutfor kop".
 */
export function normalize(text: string): string {
  return text
    .replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Buttons the probe never clicks (CLAUDE.md, "Checkout probe safety"). */
export const CLICK_DENYLIST: readonly string[] = [
  // Swedish
  'slutför',
  'betala',
  'lägg order',
  'bekräfta köp',
  'köp nu',
  'genomför köp',
  'skicka order',
  'lägg beställning',
  'bekräfta beställning',
  'bekräfta order',
  'skicka beställning',
  // English
  'place order',
  'pay',
  'confirm purchase',
  'complete purchase',
  'checkout with',
  'buy now',
  'submit order',
  'complete order',
  'confirm order',
];

// A term matches at the start of a word and may continue: "betala" also refuses "Betalas",
// "pay" also refuses "Payment", "lägg order" refuses "Lägg ordern". Over-refusing is the safe
// direction, except that a very short last word must end there: "köp nu" would otherwise
// refuse add-to-cart buttons like "Köp Nurofen".
const denyPattern = (term: string) => {
  const t = normalize(term);
  const last = t.slice(t.lastIndexOf(' ') + 1);
  return last.length < 3 ? `${t}(?= |$)` : t;
};
const DENY_RE = new RegExp(`(?:^| )(?:${CLICK_DENYLIST.map(denyPattern).join('|')})`);

/** Returns the denylisted term found in `text`, or null. */
export function matchDenylist(text: string): string | null {
  const m = DENY_RE.exec(normalize(text));
  return m ? m[0].trim() : null;
}

/** For form actions and link targets: only the path and query, so a domain can't match. */
export function urlWords(url: string): string {
  let path = url;
  try {
    const u = new URL(url, 'http://x.invalid');
    path = u.pathname + u.search;
  } catch {
    // keep the raw string
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it encoded
  }
  return path;
}

/** What the guard knows about a field before filling it. */
export interface FieldInfo {
  tag: string;
  type: string;
  /** name, id, autocomplete, placeholder, aria-label, title and label texts. */
  descriptors: string[];
}

const FIELD_RULES: { kind: string; re: RegExp }[] = [
  {
    kind: 'personal number',
    re: /person ?(?:nummer|nr)|personnr|(?:^| )(?:pnr|ssn)(?: |$)|social security|national id|identity number|personal (?:identity )?(?:number|id|code)|bank ?id|fodelse/,
  },
  {
    kind: 'card',
    re: /card|kort|(?:^| )cc(?: |$)|expir|giltighet|utgangs|iban|clearing|kontonummer|account number/,
  },
  { kind: 'cvc', re: /cvc|cvv|(?:^| )csc(?: |$)|security code|sakerhetskod/ },
  { kind: 'phone', re: /phone|telefon|mobil|(?:^| )tel(?: |$)|(?:^| )sms/ },
  { kind: 'name', re: /name|namn/ },
  { kind: 'password', re: /password|passwd|losen|(?:^| )(?:pwd|pin)(?: |$)/ },
];

const ADDRESS_RE =
  /address|adress|street|gata|gatu|(?:^| )c ?o(?: |$)|care of|apartment|lagenhet|postort|(?:^| )(?:ort|city|stad|town)(?: |$)/;
const POSTCODE_RE = /postnummer|postnr|post ?code|postal ?code|(?:^| )zip|postcode/;
const EMAIL_RE = /e ?mail|e ?post|(?:^| )mail/;

/**
 * Returns why a field must not be filled, or null. Address words are tolerated on postcode and
 * email fields (`shipping_address[zip]`, "E-postadress"), never on anything else.
 */
export function forbiddenField(field: FieldInfo): string | null {
  const type = field.type.toLowerCase();
  if (type === 'password') return 'password field';
  if (type === 'tel') return 'phone field';
  if (type === 'hidden') return 'hidden field';
  const text = field.descriptors.map(normalize).filter(Boolean).join(' | ');
  for (const rule of FIELD_RULES) {
    if (rule.re.test(text)) return `${rule.kind} field`;
  }
  if (ADDRESS_RE.test(text) && !POSTCODE_RE.test(text) && !EMAIL_RE.test(text)) {
    return 'address field';
  }
  return null;
}

/** Payment providers whose iframes the probe must never submit. */
export const PAYMENT_PROVIDERS: readonly string[] = [
  'klarna',
  'adyen',
  'svea',
  'walley',
  'collector',
  'qliro',
  'nets',
  'nexi',
  'dibs',
  'stripe',
  'paypal',
  'swish',
  'braintree',
];

const PROVIDER_RE = new RegExp(`(?:^|[^a-z])(${PAYMENT_PROVIDERS.join('|')})(?:[^a-z]|$)`, 'i');

/** Domain stems of the providers' hosts, e.g. api.walleypay.com, checkout.dibspayment.eu. */
const PROVIDER_HOSTS: readonly string[] = [
  ...PAYMENT_PROVIDERS,
  'walleypay',
  'collectorbank',
  'collectorpayments',
  'dibspayment',
  'nexigroup',
  'netaxept',
  'braintreegateway',
  'payex',
  'bambora',
  'vipps',
];

const PROVIDER_HOST_RE = new RegExp(
  `(?:^|\\.)(${PROVIDER_HOSTS.join('|')})(?:-[a-z0-9-]*)?\\.[a-z.]+$`,
);

/**
 * Returns the payment provider named in a frame's URL host, name, id, title or class, or null.
 */
export function paymentProvider(...hints: (string | null | undefined)[]): string | null {
  for (const hint of hints) {
    if (!hint) continue;
    const m = PROVIDER_RE.exec(hint.toLowerCase());
    if (m) return m[1] ?? null;
    try {
      const host = PROVIDER_HOST_RE.exec(new URL(hint).hostname);
      if (host) return host[1] ?? null;
    } catch {
      // not a URL
    }
  }
  return null;
}

// Payment-provider calls that authorize, confirm or capture, matched against the path with "_"
// turned into "-". Loading a provider's widget is allowed (it may show the delivery options).
const PROVIDER_ACTION_RE =
  /authori[sz]|confirm|complete|purchase|place|capture|finali[sz]|submit|charge|payment-intents|payment-methods|setup-intents|tokens|\/payments(?:\/|$|\?)|\/pay(?:\/|$|\?)/i;

// Store-side order placement, on any host.
const ORDER_PATH_RE =
  /place-?order|placeorder|submit-?order|create-?order|complete-?order|confirm-?order|finali[sz]e-?order|order\/(?:create|place|submit|confirm|complete|finali[sz]e)|checkout\/(?:complete|confirm|submit|place|pay(?:$|[/?]))|lagg-?order|slutfor|bekrafta-?kop/i;

/**
 * Returns why a request must be blocked, or null. This is the route interceptor's rule: a
 * second safety net behind the click guard.
 */
export function blockedRequest(url: string, method = 'GET'): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = normalizePath(u.pathname + u.search);
  if (ORDER_PATH_RE.test(path)) return 'order placement';
  const host = u.hostname.toLowerCase();
  if (PROVIDER_HOST_RE.test(host) && PROVIDER_ACTION_RE.test(path)) {
    return `payment call to ${host}`;
  }
  // POST /orders, PUT /order/123 and the like.
  if (method.toUpperCase() !== 'GET' && /\/orders?(?:\/[^/?]*)?(?:$|\?)/i.test(path)) {
    return 'order write';
  }
  return null;
}

function normalizePath(path: string): string {
  let p = path;
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep it encoded
  }
  return p.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[_ ]/g, '-');
}
