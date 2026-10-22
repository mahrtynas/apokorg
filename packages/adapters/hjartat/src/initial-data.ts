/**
 * Apotek Hjärtat (Avensia Scope) renders its state as
 *   window.INITIAL_DATA = JSON.parse('{"page":{...}}' + '...');
 * which adapter-kit's `extractWindowJson` decodes, as well as a plain object assignment.
 */
import { extractWindowJson } from '@apokorg/adapter-kit';

export { readJsStringConcat } from '@apokorg/adapter-kit';

/** Decodes `window.INITIAL_DATA` from a Hjärtat page. Undefined when missing or invalid. */
export function extractInitialData<T = unknown>(html: string): T | undefined {
  return extractWindowJson<T>(html, 'INITIAL_DATA');
}
