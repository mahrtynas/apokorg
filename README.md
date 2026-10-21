# apokorg

This is a personal tool for building a shopping basket and comparing what it costs across Swedish online stores, delivery included, then picking the cheapest way to split the order. It covers pharmacies (Apotea, Apotek Hjärtat, Apoteket, DOZ, Kronans), beauty stores (Lyko) and sport stores (Gymgrossisten), with more stores to follow.

It is a Windows desktop app (Tauri + React with a local Node server), and the same server and UI can later run as a web app.

- Plan and decisions: [docs/plan.md](docs/plan.md)
- Work packages for parallel agents: [docs/tasks/](docs/tasks/README.md)
- Contributor and agent rules: [CLAUDE.md](CLAUDE.md)

## Development

Requires Node 22+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm check
```
