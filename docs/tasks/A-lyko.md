# A-lyko – Lyko adapter

**Owns:** `packages/adapters/lyko`, `docs/stores/lyko.md` · **Depends on:** Batch 1 merged · **Batch:** 2
**Scaffold:** `pnpm new:adapter lyko "Lyko" https://lyko.com/sv beauty search-page`

Follow [the common adapter steps](_adapter-common.md).

## Known facts (research 2026-10-21, verify them)

- The platform is Avensia Scope. The search page is `GET /sv/sok?q=…`, with its data in `window.CURRENT_PAGE` (`extractWindowJson(html, 'CURRENT_PAGE')`).
- EAN: `gtin13` in JSON-LD and `"ean"` in the page data.
- **Member prices are explicit:** `memberPrice`, `isMemberPrice`, `memberPriceValidUntil` (Club Lyko). Fill in `ProductOffer.memberPrice` from them.
- Lyko loads a **Queue-it** waiting room. If a response is a queue page (detect it and test with a fixture), throw a clear `QueueError` quickly. The server will report the store as `unavailable`; never wait in the queue.
- robots.txt does not disallow search.
- Shipping: free over 300 kr; fees for each delivery method are unknown.
