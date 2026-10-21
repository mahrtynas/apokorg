# D – Desktop shell (Tauri), sidecar and installer

**Owns:** `apps/desktop` · **Depends on:** Batch 1 merged (needs `apps/ui` build and `packages/server`) · **Batch:** 2

## Goal

A Windows desktop app that starts the local server as a sidecar and shows the UI.

## Scope

- Tauri v2 app (`apps/desktop/src-tauri`) that loads `apps/ui/dist` in production and the Vite dev server in development.
- **Sidecar:** bundle `packages/server` into a single file with esbuild, then into one exe with Node's single-executable-application feature. Add it as a Tauri `externalBin`.
  - Native modules (`better-sqlite3`) need care: ship the `.node` file next to the exe, or switch to `node:sqlite` if it's stable by then. Document the choice.
- Startup:
  - spawn the sidecar with `APOKORG_PORT=0` (a random free port) and `APOKORG_DATA_DIR` set to the app data dir
  - wait for the `READY <port>` line, then pass the port to the UI (Tauri command or injected global)
  - kill the sidecar when the app exits
- Single instance. Window title "apokorg". A basic app icon (placeholder is fine).
- `pnpm --filter @apokorg/desktop dev` runs the UI dev server, the server in watch mode, and Tauri dev.
- `pnpm --filter @apokorg/desktop build` produces an NSIS installer.
- Add a `windows-latest` CI job that builds the installer, on manual trigger or on tags only, since it's slow.

## Acceptance criteria

- On a clean Windows machine with Edge only and no Node, the installer installs, the app starts, and a mock-mode search works. Add a hidden setting or an env var for mock mode.
- Closing the window leaves no orphaned sidecar process.
- The README section on building the installer is updated.
