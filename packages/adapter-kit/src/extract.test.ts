import { describe, expect, it } from 'vitest';
import { extractWindowJson, findJsonLd } from './extract';
import { readJsStringConcat } from './js-string';

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

  it('decodes window.X = JSON.parse(...) with escapes and concatenated literals', () => {
    // As on the page: a JS-escaped quote, a concatenation and a JSON escape inside the literal.
    const page = String.raw`<script>window.INITIAL_DATA = JSON.parse('{"a":"it\'s","b":"<!-' + '- x -->\\n","c":"ä"}');</script>`;
    expect(extractWindowJson(page, 'INITIAL_DATA')).toEqual({
      a: "it's",
      b: '<!-- x -->\n',
      c: 'ä',
    });
    expect(extractWindowJson(String.raw`window.X = JSON.parse("{\"n\":1}")`, 'X')).toEqual({
      n: 1,
    });
    expect(extractWindowJson("window.X = JSON.parse('{oops')", 'X')).toBeUndefined();
    expect(readJsStringConcat('foo', 0)).toBeUndefined();
  });

  it('returns undefined for missing globals', () => {
    expect(extractWindowJson(html, 'NOPE')).toBeUndefined();
  });
});
