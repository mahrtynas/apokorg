import { describe, expect, it } from 'vitest';
import { extractWindowJson, findJsonLd } from './extract';

const html = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Alvedon","gtin13":"4006381333931"}]}</script>
<script type="application/ld+json">{ broken </script>
</head><body>
<script>window.INITIAL_DATA = {"products":[{"name":"A \\"quoted\\" } brace","price":{"current":39}}]};</script>
</body></html>`;

describe('extract', () => {
  it('finds Product JSON-LD inside @graph and skips broken blocks', () => {
    expect(findJsonLd(html, 'Product')).toMatchObject({ name: 'Alvedon', gtin13: '4006381333931' });
  });

  it('extracts window globals with nested objects and braces in strings', () => {
    const data = extractWindowJson<{ products: { name: string; price: { current: number } }[] }>(
      html,
      'INITIAL_DATA',
    );
    expect(data?.products[0]?.price.current).toBe(39);
    expect(data?.products[0]?.name).toBe('A "quoted" } brace');
  });

  it('returns undefined for missing globals', () => {
    expect(extractWindowJson(html, 'NOPE')).toBeUndefined();
  });
});
