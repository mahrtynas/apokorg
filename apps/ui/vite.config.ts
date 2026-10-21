/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const nodeStub = fileURLToPath(new URL('./src/mocks/node-stub.ts', import.meta.url));

/**
 * Serves MSW's service worker at /mockServiceWorker.js in mock mode, straight from the msw
 * package, so no generated file has to live in the repo or end up in dist.
 */
function mswWorker(): Plugin {
  return {
    name: 'apokorg-msw-worker',
    apply: 'serve',
    configureServer(server) {
      const workerPath = require.resolve('msw/mockServiceWorker.js');
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(readFileSync(workerPath));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset paths so the Tauri shell can load dist/ from its own protocol.
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'mock' ? [mswWorker()] : [])],
  resolve: {
    // @apokorg/adapter-mock pulls in adapter-kit, whose fixture helpers import node built-ins.
    // They are never called in the browser; stub them so the mock data can be bundled.
    alias: (process.env.VITEST
      ? {}
      : { 'node:fs/promises': nodeStub, 'node:path': nodeStub }) as Record<string, string>,
  },
  server: { port: 5173, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}));
