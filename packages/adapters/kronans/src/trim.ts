/**
 * Shrinks live responses before they are committed as fixtures. Elevate returns facets,
 * click-tracking tickets and image lists the adapter never reads, and product pages are
 * ~220 KB of HTML (FASS leaflets, menus). Trimming must not change what parseSearch and
 * parseProduct return.
 */

interface ElevateProduct {
  ticket?: string;
  swatch?: unknown;
  imageInfo?: { thumbnail?: string };
  variants?: { ticket?: string }[];
  [key: string]: unknown;
}

interface ElevateBody {
  q?: string;
  primaryList?: {
    totalHits?: number;
    productGroups?: { key?: string; products?: ElevateProduct[] }[];
  };
}

export function trimSearchBody(body: string): string {
  const json = JSON.parse(body) as ElevateBody;
  const productGroups = (json.primaryList?.productGroups ?? []).map((g) => ({
    key: g.key,
    products: (g.products ?? []).map(({ ticket: _t, swatch: _s, imageInfo, variants, ...p }) => ({
      ...p,
      imageInfo: imageInfo?.thumbnail ? { thumbnail: imageInfo.thumbnail } : undefined,
      variants: variants?.map(({ ticket: _vt, ...v }) => v),
    })),
  }));
  const trimmed = {
    q: json.q,
    primaryList: { totalHits: json.primaryList?.totalHits ?? 0, productGroups },
  };
  return JSON.stringify(trimmed, null, 1) + '\n';
}

/**
 * Keeps the JSON-LD scripts and the few HTML fragments parseProduct reads: the title
 * heading, campaign badges, the prescription notice and the price box.
 */
export function trimProductHtml(html: string): string {
  const keep = [
    ...(html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? []),
    '</head><body>',
    ...(html.match(
      /<h1[^>]*id="product-content-title"[^>]*>[^<]*<\/h1>(?:<h2[^>]*>[^<]*<\/h2>)?/g,
    ) ?? []),
    ...(html.match(/<div aria-label="[^"]+? Rabatt på [^"]+"[^>]*>/g) ?? []).map(
      (d) => `${d}</div>`,
    ),
    ...(html.match(/<p[^>]*>Du behöver ett recept för att kunna köpa[^<]*<\/p>/g) ?? []),
    ...(html.match(/<h3[^>]*>(?:Pris med recept|Kampanjpris|Pris online)<\/h3>/g) ?? []),
  ];
  return ['<!doctype html><html><head>', ...keep, '</body></html>', ''].join('\n');
}
