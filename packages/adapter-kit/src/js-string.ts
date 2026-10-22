/**
 * Decoding of JavaScript string literals, for pages that embed their state as
 *   window.X = JSON.parse('{"page":{...}}' + '...');
 * i.e. a JSON document inside a single- or double-quoted literal with JS escapes, sometimes
 * split with `' + '` (around `<!--` in embedded script snippets). Avensia Scope sites do this.
 */

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
