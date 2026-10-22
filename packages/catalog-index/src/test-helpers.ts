import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FetchBytes } from './sitemap';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

/** Serves `routes[url]` from fixtures/ and records every requested URL. */
export function fixtureFetch(routes: Record<string, string>): FetchBytes & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const name = routes[url];
    if (!name) throw new Error(`Unexpected fetch: ${url}`);
    return fixture(name);
  };
  return Object.assign(fn, { calls });
}
