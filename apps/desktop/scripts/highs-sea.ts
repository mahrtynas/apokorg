/**
 * Stands in for `highs` inside the sidecar bundle (see build-sidecar.ts). The Emscripten
 * loader reads `highs.wasm` from next to its own file, which doesn't exist inside a single
 * executable, so when running as one we instantiate the module from the SEA asset instead.
 * (The loader's `wasmBinary` option is typed but ignored by this build; `instantiateWasm`
 * is the hook it actually calls.)
 */
import highsLoader, { type InitOptions } from 'highs';
import { getAsset, isSea } from 'node:sea';

export type * from 'highs';

// The repo's TS lib has no WebAssembly globals (no DOM lib); this is the slice we use.
interface Wasm {
  instantiate(bytes: ArrayBuffer, imports: object): Promise<{ instance: object }>;
}
const { WebAssembly: wasm } = globalThis as unknown as { WebAssembly: Wasm };

function instantiateWasm(imports: object, done: (instance: object) => void): object {
  void wasm.instantiate(getAsset('highs.wasm'), imports).then((r) => done(r.instance));
  return {};
}

export default function loadHighs(options?: InitOptions): ReturnType<typeof highsLoader> {
  return highsLoader(isSea() ? ({ ...options, instantiateWasm } as InitOptions) : options);
}
