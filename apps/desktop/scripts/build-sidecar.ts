/**
 * Builds the server sidecar: `packages/server` bundled into one CommonJS file with esbuild,
 * then baked into a copy of node.exe as a Node single executable application (SEA). The
 * result lands in `src-tauri/binaries/apokorg-server-<target-triple>.exe`, where Tauri's
 * `externalBin` picks it up.
 *
 * The server uses the built-in `node:sqlite`, so there is no native addon to ship. The only
 * non-JS file is the HiGHS solver's `highs.wasm`, which goes in as a SEA asset.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = join(root, '..', '..');
const outDir = join(root, 'dist', 'sidecar');
const binDir = join(root, 'src-tauri', 'binaries');
const require = createRequire(import.meta.url);

const highsShim = join(root, 'scripts', 'highs-sea.ts');
const highsWasm = join(dirname(require.resolve('highs')), 'highs.wasm');

/**
 * Routes every `highs` import through highs-sea.ts. The shim's own import gets the CommonJS
 * build: the ESM one needs `import.meta.url`, which is empty in a CommonJS bundle.
 */
const highsPlugin: Plugin = {
  name: 'highs-sea',
  setup(b) {
    b.onResolve({ filter: /^highs$/ }, (args) => ({
      path: args.importer === highsShim ? require.resolve('highs') : highsShim,
    }));
  },
};

function targetTriple(): string {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host: (\S+)$/m.exec(out)?.[1];
  if (!host) throw new Error('Could not read the host triple from `rustc -vV`');
  return host;
}

// The registry's adapter list is generated and not checked in.
execFileSync(process.execPath, [join(repo, 'scripts', 'gen-registry.mjs')], { stdio: 'inherit' });

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

const bundle = join(outDir, 'server.cjs');
await build({
  entryPoints: [join(repo, 'packages', 'server', 'src', 'main.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  plugins: [highsPlugin],
  // playwright-core can't live in a single executable (optional chromium-bidi modules, and it
  // reads its own files at runtime). The server imports checkout-probe lazily, so without it
  // a probe fails cleanly and the optimizer keeps the JSON shipping rules.
  external: ['@apokorg/checkout-probe'],
  logLevel: 'warning',
});
// Lets `node dist/sidecar/server.cjs` run outside the SEA too, for debugging.
copyFileSync(highsWasm, join(outDir, 'highs.wasm'));

const seaConfig = join(outDir, 'sea-config.json');
const blob = join(outDir, 'server.blob');
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets: { 'highs.wasm': highsWasm },
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

const ext = process.platform === 'win32' ? '.exe' : '';
const exe = join(binDir, `apokorg-server-${targetTriple()}${ext}`);
copyFileSync(process.execPath, exe);
execFileSync(
  process.execPath,
  [
    require.resolve('postject/dist/cli.js'),
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: 'inherit' },
);
console.log(`sidecar: ${exe}`);
