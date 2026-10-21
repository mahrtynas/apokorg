# P-<store> – Checkout probe script for one store

**Owns:** `packages/adapters/<id>/src/probe.ts` (plus its test and fixtures) · **Depends on:** CP merged, and the store's adapter task showing "probe supported" · **Batch:** 3
Create one PR per store, as `P-apoteket`, `P-hjartat` and so on.

## Goal

Implement `adapter.probe` for one store, using only the `GuardedPage` API.

## Scope

- Steps:
  1. Add the request's items to the cart (product URL → add-to-cart button).
  2. Open the cart and go to guest checkout.
  3. Enter the postcode and probe email when asked.
  4. Read every delivery option name and fee shown, and map each to `DeliveryOption` (`kind` inferred from its name).
  5. Empty the cart.
- Return a `ProbeResult` with status `ok`. If you hit a login or BankID wall, return `unsupported` with a message. On unexpected layout, return `failed` with `layout-changed`.
- Selectors go in one constant object at the top of the file, so they're easy to fix when the site changes.
- Update `docs/stores/<id>.md` with the probe steps and the date.

## Acceptance criteria

- An offline test drives `probe.ts` against a saved copy of the store's checkout HTML (with personal data removed) on the CP test server, and checks the parsed options.
- One manual live run with a cheap item and postcode 11738. Paste the result into the PR, and confirm the cart is empty afterwards and **no order was placed**.
