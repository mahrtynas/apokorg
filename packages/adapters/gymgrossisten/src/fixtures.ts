/**
 * Fixture helpers (used by live.test.ts when recording). Gymgrossisten product pages are about
 * 400 KB, mostly scripts, styles, icons and the mega menu. We drop those and the head except
 * the canonical link and og:image, which keeps the product markup the parser reads unchanged.
 */

const DROP = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<svg\b[\s\S]*?<\/svg>/gi,
  /<noscript\b[\s\S]*?<\/noscript>/gi,
  /<nav\b[\s\S]*?<\/nav>/gi,
  /<footer\b[\s\S]*?<\/footer>/gi,
  /<!--[\s\S]*?-->/g,
  // Shipping and return-policy microdata, repeated in every variant's offer (~2 KB each).
  /<div itemprop="shippingDetails"[\s\S]*?itemprop="returnFees"[^>]*>\s*<\/div>/g,
  // Base64 images pasted into product descriptions (one is 185 KB).
  /\s(?:src|srcset)="data:[^"]*"/gi,
];

export function trimProductPage(html: string): string {
  const keepHead = [
    /<link rel="canonical"[^>]*>/.exec(html)?.[0],
    /<meta property="og:image"[^>]*>/.exec(html)?.[0],
  ].filter(Boolean);
  let body = html.slice(Math.max(0, html.search(/<body\b/i)));
  for (const re of DROP) body = body.replace(re, '');
  body = body.replace(/^\s*\n/gm, '');
  return `<!DOCTYPE html>\n<html lang="sv"><head><title>fixture</title>\n${keepHead.join('\n')}\n</head>\n${body}`;
}
