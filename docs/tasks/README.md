# Work packages

Each file here is one self-contained task for one agent, in its own worktree on branch `agent/<task-id>`. Read [CLAUDE.md](../../CLAUDE.md) first: it has the ownership rules, contract-change process and probe safety rules.

Suggested agent prompt:

> Implement task `<ID>` as described in `docs/tasks/<ID>.md`. Follow CLAUDE.md. Open a PR to main when `pnpm check` and `pnpm format:check` pass.

Progress is tracked by PR status on GitHub, not in this file, to avoid merge conflicts.

## Batch 1 (start now, all in parallel)

| ID                          | Task                                 | Owns                                                    |
| --------------------------- | ------------------------------------ | ------------------------------------------------------- |
| [M](M-matcher.md)           | Matcher                              | `packages/matcher`                                      |
| [O](O-optimizer.md)         | Optimizer + shipping rules           | `packages/optimizer`                                    |
| [SV](SV-server.md)          | Server, DB, cache                    | `packages/server`                                       |
| [U](U-ui.md)                | UI                                   | `apps/ui`                                               |
| [A-apoteket](A-apoteket.md) | Apoteket adapter (Loop54 API)        | `packages/adapters/apoteket`, `docs/stores/apoteket.md` |
| [A-hjartat](A-hjartat.md)   | Apotek Hjärtat adapter (search page) | `packages/adapters/hjartat`, `docs/stores/hjartat.md`   |

## Batch 2 (after Batch 1 is merged)

| ID                            | Task                             | Owns                                                  |
| ----------------------------- | -------------------------------- | ----------------------------------------------------- |
| [CI-x](CI-x-catalog-index.md) | Sitemap catalog index            | `packages/catalog-index`                              |
| [A-kronans](A-kronans.md)     | Kronans adapter (Elevate API)    | `packages/adapters/kronans`, `docs/stores/kronans.md` |
| [A-lyko](A-lyko.md)           | Lyko adapter (search page)       | `packages/adapters/lyko`, `docs/stores/lyko.md`       |
| [CP](CP-checkout-probe.md)    | Checkout probe framework + guard | `packages/checkout-probe`                             |
| [D](D-desktop.md)             | Tauri shell, sidecar, installer  | `apps/desktop`                                        |

## Batch 3 (after CI-x and CP are merged)

| ID                                    | Task                                          | Owns                                                              |
| ------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| [A-apotea](A-apotea.md)               | Apotea adapter (catalog index)                | `packages/adapters/apotea`, `docs/stores/apotea.md`               |
| [A-doz](A-doz.md)                     | DOZ adapter (catalog index)                   | `packages/adapters/doz`, `docs/stores/doz.md`                     |
| [A-gymgrossisten](A-gymgrossisten.md) | Gymgrossisten adapter (catalog index)         | `packages/adapters/gymgrossisten`, `docs/stores/gymgrossisten.md` |
| [P-store](P-store-probe.md)           | Probe script for one store (repeat per store) | `packages/adapters/<id>/src/probe.ts`                             |

## Later

- **Phase 2:** end-to-end integration, matcher tuning on about 50 labelled real queries, adapters for Bangerhead, KICKS, MM Sports and Svensk Kosttillskott, installer polish.
- **Phase 3:** web deployment (review store terms first), optional price history.

## Template for a new task

```md
# <ID> – <title>

**Owns:** paths · **Depends on:** merged tasks · **Batch:** n

## Goal

## Scope

## Interfaces (from packages/core)

## Acceptance criteria

## Test commands
```
