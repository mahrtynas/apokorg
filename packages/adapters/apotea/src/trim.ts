/**
 * Shrinks live responses before they are committed as fixtures. Product pages are ~500 KB
 * and sitemaps ~7 MB (50 000 URLs each), almost all of it irrelevant. Trimming must not
 * change what parseProduct or the catalog index return for the kept entries.
 */

/** Keeps the JSON-LD scripts, the price/stock box and the product facts list. */
export function trimProductHtml(html: string): string {
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const parts = [...ld];
  const box = html.indexOf('<div id="stock-price-box"');
  if (box >= 0) {
    // The box ends where the buy button or the pack-size picker starts.
    const ends = ['id="productdetail-button-container"', 'class="product-family"']
      .map((m) => html.indexOf(m, box))
      .filter((i) => i > box);
    parts.push(html.slice(box, ends.length ? Math.min(...ends) : box + 5_000));
  }
  const facts = html.match(/<dl id="product-facts-list"[\s\S]*?<\/dl>/);
  if (facts) parts.push(facts[0]);
  return ['<!doctype html><html><head>', ...parts, '</head><body></body></html>', ''].join('\n');
}

/** Keeps only the `<url>` entries whose `<loc>` passes `keep`. */
export function trimSitemap(xml: string, keep: (loc: string) => boolean): string {
  const urls = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  const kept = urls.filter((u) => keep(u.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? ''));
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...kept.map((u) => `  ${u.replace(/\s+/g, ' ')}`),
    '</urlset>',
    '',
  ].join('\n');
}
