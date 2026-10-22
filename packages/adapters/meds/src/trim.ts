/**
 * Shrinks live responses before they are committed as fixtures. Product pages are ~80 KB and
 * sitemaps ~3 MB (10 000 URLs each), mostly irrelevant. Trimming must not change what
 * parseProduct or the catalog index return for the kept entries.
 */

/** Keeps the JSON-LD scripts, the stock/price box and the Produktfakta list. */
export function trimProductHtml(html: string): string {
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const parts = [...ld];
  const box = html.indexOf('<div class="stock-price">');
  if (box >= 0) {
    // The box ends at the buy buttons, or after the prescription login button.
    const ends = ['<div class="product-buttons', '<a class="rx-mini-banner"']
      .map((m) => html.indexOf(m, box))
      .filter((i) => i > box);
    parts.push(html.slice(box, ends.length ? Math.min(...ends) : box + 4_000));
  }
  const facts = html.match(
    /<details class="details">\s*<summary[^>]*>Produktfakta<\/summary>[\s\S]*?<\/details>/,
  );
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
