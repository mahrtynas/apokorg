/**
 * Shrinks live product pages (~1.8 MB, mostly menus and related-product cards) before they
 * are committed as fixtures. Trimming must not change what parseProduct returns.
 */

/** Keeps the JSON-LD scripts and the `<h1>` with the package line below it. */
export function trimProductHtml(html: string): string {
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const header =
    html.match(/<h1[^>]*>[\s\S]*?<\/h1>(?:\s*<div[^>]*>\s*<span[^>]*>[\s\S]*?<\/span>)?/)?.[0] ??
    '';
  return ['<!doctype html><html><head>', ...ld, '</head><body>', header, '</body></html>', ''].join(
    '\n',
  );
}
