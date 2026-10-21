/** Helpers for pulling structured data out of HTML without a full DOM. */

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
 * `window.CURRENT_PAGE = JSON.parse("...")`. Uses brace matching, so it handles nested objects.
 */
export function extractWindowJson<T = unknown>(html: string, name: string): T | undefined {
  const idx = html.search(new RegExp(`window\\.${name}\\s*=\\s*`));
  if (idx < 0) return undefined;
  const start = html.indexOf('{', idx);
  if (start < 0) return undefined;
  const json = sliceBalanced(html, start);
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
