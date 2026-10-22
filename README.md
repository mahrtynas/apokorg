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

## Desktop app and installer

The desktop app (`apps/desktop`) is a Tauri v2 shell around the UI. It starts the server as a sidecar on a random port, waits for its `READY <port>` line, and opens the UI with that port injected before the page loads. The sidecar is killed when the app exits; on Windows it also runs in a kill-on-close job object, so it can't outlive the app even after a crash.

Building it needs, besides Node 24 and pnpm:

- Rust: `winget install --id Rustlang.Rustup -e`, then `rustup default stable-x86_64-pc-windows-msvc`
- the MSVC C++ build tools: `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
- WebView2, which ships with Windows 11

```sh
pnpm --filter @apokorg/desktop dev     # UI dev server + server in watch mode + Tauri dev window
pnpm --filter @apokorg/desktop build   # NSIS installer
```

The installer lands in `apps/desktop/src-tauri/target/release/bundle/nsis/apokorg_<version>_x64-setup.exe`. It installs per user and needs neither Node nor admin rights; if WebView2 is missing it downloads it.

How the sidecar is built (`apps/desktop/scripts/build-sidecar.ts`): esbuild bundles `packages/server` into one CommonJS file, which is baked into a copy of the building `node.exe` as a [Node single executable application](https://nodejs.org/api/single-executable-applications.html) at `src-tauri/binaries/apokorg-server-<target-triple>.exe`, Tauri's `externalBin`. The server stores data with Node's built-in `node:sqlite`, so there is no native addon to ship. The one non-JS file, the HiGHS solver's `highs.wasm`, is embedded as a SEA asset.

- Mock mode (fake stores, no network): start the app with `--mock`, or set `APOKORG_MOCK=1`. In dev, `APOKORG_MOCK=1 pnpm --filter @apokorg/desktop dev` puts the dev server in mock mode.
- App data and the server log (`server.log`) live in `%APPDATA%\se.apokorg.desktop`.
- Smart App Control: the app and installer are not code-signed, so Windows 11 machines with Smart App Control on block them, and block the local build too (cargo's build scripts are fresh unsigned executables). Build in CI on such a machine. The long-term fix is code signing, e.g. Azure Trusted Signing.
- The `Desktop installer` workflow builds the installer on `windows-latest` when run by hand or on a `v*` tag, and uploads it as an artifact.
