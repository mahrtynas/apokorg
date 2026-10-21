# CP – Checkout probe framework and guard

**Owns:** `packages/checkout-probe` · **Depends on:** Batch 1 merged · **Batch:** 2

## Goal

Get the real delivery fees from a store's guest checkout for a given cart and postcode, **without any chance of placing an order**. Per-store probe scripts (task P-store) plug into this.

## Scope

- `runProbe(adapter, request)` launches **installed Microsoft Edge** through `playwright-core` (`chromium.launch({ channel: 'msedge', headless: true })`).
  - Use a fresh, temporary profile directory that is deleted afterwards. It never touches your real browser profile.
  - Implement `GuardedPage` from `@apokorg/core` on top of the Playwright page, and pass only that to `adapter.probe`.
- **Guard** (the core of this task, heavily tested):
  - `click(selector)`: resolve the element and read its text, `value`, `aria-label` and the enclosing `<form action>`. Refuse with `ForbiddenActionError` if any of them matches the denylist (case-insensitive, Swedish and English):
    - Swedish: `slutför`, `betala`, `lägg order`, `bekräfta köp`, `köp nu`, `genomför köp`, `skicka order`
    - English: `place order`, `pay`, `confirm purchase`, `complete purchase`, `checkout with`
  - Also refuse submit buttons inside payment iframes: Klarna, Adyen, Svea, Walley, Qliro, Nets, Stripe.
  - `fill(selector, value)`: allowed only when `value` is the configured postcode or probe email. Refuse when the target field's name, id, autocomplete or label suggests: personnummer/ssn, card, cvc, phone, name, address (other than postal code), password.
  - A route interceptor blocks any request to known payment and order-placement endpoints (patterns per payment provider) as a second safety net.
- Afterwards: the per-store `probe.ts` empties the cart (`emptyCart` step), and the framework always closes the browser and deletes the profile, even on errors.
- Global timeout of 60 s per probe. Results are cached through the server's `probe_cache` (24 h, keyed by store, order-value band and postcode). Expose a function; the server wires it in.
- Clear errors: `edge-not-found`, `login-required` (→ status `unsupported`), `timeout`, `layout-changed`.

## Acceptance criteria

- Guard tests on local fixture HTML pages, served from a static test server and run with Playwright, Edge or bundled Chromium; CI can use `npx playwright install chromium`:
  - every denylisted button is refused
  - every forbidden field is refused
  - the allowed postcode and email fields succeed
  - a payment-iframe submit is refused
  - a blocked order endpoint is never requested
- A cleanup test: the profile dir is gone after both success and a thrown error.
- No real store is contacted in tests.

## Test commands

`pnpm --filter @apokorg/checkout-probe test`
