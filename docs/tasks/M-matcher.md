# M – Matcher

**Owns:** `packages/matcher` · **Depends on:** Phase 0 · **Batch:** 1

## Goal

Given a user's rough query (e.g. "alvedon 500 20st") and the raw `ProductOffer[]` returned by each store, decide which offers are the **same product** and which are **substitutes**, with a confidence score.

## Scope

- `normalize(text)`:
  - lowercase and strip diacritics for matching only (å/ä/ö → a/a/o)
  - unify units: "500mg" = "500 mg"; "st", "tabl" and "tabletter" are all pack counts
  - brand aliases (e.g. "LRP" → "la roche-posay"), in a small editable JSON file
- `parseQuery(query)` → `{ brand?, tokens, strength?, size?, packCount? }`. Reuse `parseSize`, `parsePackCount` and `normalizeEan` from `@apokorg/adapter-kit`.
- `matchOffers(query, offers, { acceptSubstitutes, pinned, llm? })` → `MatchResult[]`:
  1. Pinned: the user's confirmed `merchantProductId` for that store always wins (`exact`, confidence 1).
  2. EAN: once one offer is confirmed as exact, every offer with the same EAN at other stores is `exact`.
  3. Scoring: brand, token overlap, strength (mg), size and pack count. Same everything except pack size → `substitute`. Different brand → `substitute` only when the query has no brand.
  4. LLM fallback (optional): when the top two candidates for a store are within a small margin, ask Claude `claude-haiku-5-5` with structured output to pick or reject. It is injected as an interface so tests use a fake. Read the API key from settings, and skip this step when there is no key.
- `needsConfirmation`: true when no exact match reaches confidence ≥ 0.8 at any store.
- Remembering choices: export a pure function. Persistence is SV's job.

## Interfaces

`ProductOffer`, `MatchResult`, `MatchKind` and `BasketItem['pinned']` from `@apokorg/core`.

## Acceptance criteria

- A labelled test set of at least 25 cases, built from the mock catalog plus invented realistic titles. It must include:
  - Alvedon 20 vs 10 st → substitute
  - SPF50 50 ml vs 30 ml
  - the same whey in different flavours → substitute
  - "Nivea creme" with no size given → picks the 150 ml, kind `equivalent`
- With substitutes off, no `substitute` result is returned.
- The LLM path is tested with a fake client. No network calls in tests.
- Per-call latency without the LLM is under 5 ms for 100 offers.

## Test commands

`pnpm --filter @apokorg/matcher test`
