/**
 * Shrinks live responses before they are committed as fixtures. Loop54 returns ~12 KB per
 * product (HTML descriptions, category trees) and product pages are ~300 KB, almost all of
 * it irrelevant. Trimming must not change what parseSearch/parseProduct return.
 */

/** Loop54 attributes the adapter reads, plus a few kept for reference in the docs. */
const KEEP_ATTRIBUTES = new Set([
  'Id',
  'Name',
  'Brand',
  'ProductURL',
  'ImageURL',
  'Price',
  'CampaignPrice',
  'CampaignLabel',
  'CampaignLabelType',
  'PercentDiscount',
  'LowestPriceLast30Days',
  'InStorePrice',
  'InStock',
  'Availability',
  'PrescriptionRequired',
  'Type',
  'Ean',
  'PackageText',
  'IsPackage',
]);

interface Entity {
  type: string;
  id: string;
  attributes?: { name: string }[];
}

export function trimSearchBody(body: string): string {
  const json = JSON.parse(body) as { results?: { count?: number; items?: Entity[] } };
  const items = (json.results?.items ?? []).map((e) => ({
    ...e,
    attributes: (e.attributes ?? []).filter((a) => KEEP_ATTRIBUTES.has(a.name)),
  }));
  return JSON.stringify({ results: { count: json.results?.count ?? 0, items } }, null, 1) + '\n';
}

/**
 * Keeps the JSON-LD scripts and the product's own block of the RSC payload, which hold
 * everything parseProduct reads.
 */
export function trimProductHtml(html: string): string {
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const start = html.indexOf('\\"product\\":{\\"id\\"');
  let rsc = '';
  if (start >= 0) {
    const end = html.indexOf('\\"breadCrumbs\\"', start);
    rsc = html.slice(start, end > start ? end : start + 20_000);
    // Long HTML descriptions are not parsed; drop them.
    rsc = rsc.replace(
      /\\"descriptionList\\":\[[\s\S]*?\],\\"varuNr/,
      '\\"descriptionList\\":[],\\"varuNr',
    );
  }
  return [
    '<!doctype html><html><head>',
    ...ld,
    '</head><body>',
    `<script>self.__next_f.push([1,"${rsc}"])</script>`,
    '</body></html>',
    '',
  ].join('\n');
}
