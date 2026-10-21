# A-gymgrossisten – Gymgrossisten adapter

**Owns:** `packages/adapters/gymgrossisten`, `docs/stores/gymgrossisten.md` · **Depends on:** CI-x merged · **Batch:** 3
**Scaffold:** `pnpm new:adapter gymgrossisten "Gymgrossisten" https://www.gymgrossisten.com sport catalog-index`

Follow [the common adapter steps](_adapter-common.md).

## Strategy

robots.txt disallows `/search*` and `/*?q=*`. Use catalog-index candidates, then product pages.

## Known facts (research 2026-10-21, verify them)

- Salesforce Commerce Cloud, server-rendered.
- **EAN appears only as visible text** ("EAN 7350049151014"), not in JSON-LD. Parse it from the HTML and validate it with `normalizeEan`.
- Supplements come in flavours and sizes, often as **variants of one product URL**. Give each variant (flavour × size) its own `ProductOffer`, with a stable `merchantProductId` and the flavour in the title, so the matcher can tell "Whey-80 1 kg Chocolate" from "Vanilla".
- Free shipping from 499 kr (some page text still says 599). Fees are only shown in checkout.
- Club GG member offers exist; find out how they're priced.
- Behind Cloudflare, but no challenge was seen.
