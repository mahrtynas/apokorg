/** Helpers for pulling structured data out of HTML without a full DOM. */
import { readJsStringConcat } from './js-string';

/** All JSON-LD blocks on a page, with @graph arrays flattened. Invalid blocks are skipped. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1]!.trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const graph = (item as Record<string, unknown>)['@graph'];
          if (Array.isArray(graph)) out.push(...(graph as Record<string, unknown>[]));
          else out.push(item as Record<string, unknown>);
        }
      }
    } catch {
      // Some sites ship broken JSON-LD; ignore it.
    }
  }
  return out;
}

/** The first JSON-LD node whose @type matches (e.g. "Product"). */
export function findJsonLd(html: string, type: string): Record<string, unknown> | undefined {
  return extractJsonLd(html).find((node) => {
    const t = node['@type'];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

/**
 * Extracts a JSON object assigned to a global, e.g. `window.INITIAL_DATA = {...};` or
 * `window.CURRENT_PAGE = JSON.parse('...' + '...')`. Object literals use brace matching, so nested
 * objects work; `JSON.parse` arguments are decoded as JS string literals first.
 */
export function extractWindowJson<T = unknown>(html: string, name: string): T | undefined {
  const m = new RegExp(`window\\.${name}\\s*=\\s*(JSON\\.parse\\(\\s*)?`).exec(html);
  if (!m) return undefined;
  let json: string | undefined;
  if (m[1]) {
    json = readJsStringConcat(html, m.index + m[0].length);
  } else {
    const start = html.indexOf('{', m.index);
    if (start < 0) return undefined;
    json = sliceBalanced(html, start);
  }
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/** Next.js pages router payload. */
export function extractNextData<T = unknown>(html: string): T | undefined {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!) as T;
  } catch {
    return undefined;
  }
}

function sliceBalanced(s: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return undefined;
}
