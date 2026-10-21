/**
 * Apotek Hjärtat (Avensia Scope) renders its state as
 *   window.INITIAL_DATA = JSON.parse('{"page":{...}}' + '...');
 * i.e. a JSON document inside a JS single-quoted string literal, with `\'` and `\\` escapes,
 * and sometimes split with `' + '` (around `<!--` in embedded script snippets). The generic
 * `extractWindowJson` from adapter-kit expects a bare object literal, so this file decodes the
 * string literal(s) first. It falls back to `extractWindowJson` if the site ever switches to a
 * plain object assignment.
 */
import { extractWindowJson } from '@apokorg/adapter-kit';

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

/**
 * Reads a concatenation of JS string literals (`'a' + "b" + 'c'`) starting at `start`.
 * Returns the decoded string, or undefined when the source is not a string literal.
 */
export function readJsStringConcat(src: string, start: number): string | undefined {
  let i = start;
  let out = '';
  let sawLiteral = false;
  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  for (;;) {
    skipWs();
    const quote = src[i];
    if (quote !== "'" && quote !== '"') break;
    i++;
    let closed = false;
    while (i < src.length) {
      const c = src[i]!;
      if (c === quote) {
        closed = true;
        i++;
        break;
      }
      if (c === '\\') {
        const e = src[i + 1];
        if (e === undefined) return undefined;
        if (e === 'u') {
          if (src[i + 2] === '{') {
            const end = src.indexOf('}', i + 3);
            if (end < 0) return undefined;
            out += String.fromCodePoint(parseInt(src.slice(i + 3, end), 16));
            i = end + 1;
          } else {
            out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
            i += 6;
          }
        } else if (e === 'x') {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
          i += 4;
        } else if (e === '\r' || e === '\n') {
          // Line continuation.
          i += e === '\r' && src[i + 2] === '\n' ? 3 : 2;
        } else {
          out += SIMPLE_ESCAPES[e] ?? e;
          i += 2;
        }
        continue;
      }
      out += c;
      i++;
    }
    if (!closed) return undefined;
    sawLiteral = true;
    skipWs();
    if (src[i] === '+') i++;
    else break;
  }
  return sawLiteral ? out : undefined;
}

/** Decodes `window.INITIAL_DATA` from a Hjärtat page. Undefined when missing or invalid. */
export function extractInitialData<T = unknown>(html: string): T | undefined {
  const re = /window\.INITIAL_DATA\s*=\s*JSON\.parse\(/g;
  const m = re.exec(html);
  if (m) {
    const json = readJsStringConcat(html, re.lastIndex);
    if (json === undefined) return undefined;
    try {
      return JSON.parse(json) as T;
    } catch {
      return undefined;
    }
  }
  return extractWindowJson<T>(html, 'INITIAL_DATA');
}
