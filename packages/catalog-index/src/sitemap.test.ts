import { describe, expect, it } from 'vitest';
import { decodeBody, parseSitemap, robotsSitemaps } from './sitemap';
import { fixture } from './test-helpers';

describe('parseSitemap', () => {
  it('parses an index, including CDATA locs', () => {
    const doc = parseSitemap(decodeBody(fixture('sitemap-index.xml')));
    expect(doc).toEqual({
      kind: 'index',
      sitemaps: [
        { loc: 'https://shop.test/sitemap-pages.xml', lastmod: '2026-10-01' },
        { loc: 'https://shop.test/sitemap-products-1.xml', lastmod: '2026-10-20' },
        { loc: 'https://shop.test/sitemap-products-2.xml.gz', lastmod: '2026-10-21' },
      ],
    });
  });

  it('gunzips a gzipped child and handles a missing lastmod', () => {
    const doc = parseSitemap(decodeBody(fixture('sitemap-products-2.xml.gz')));
    expect(doc).toEqual({
      kind: 'urlset',
      urls: [
        {
          loc: 'https://shop.test/p/panodil-500-mg-filmdragerad-tablett-20-st',
          lastmod: '2026-10-21',
        },
        { loc: 'https://shop.test/p/m%C3%B6llers-omega-3-250-ml' },
      ],
    });
  });

  it('decodes entities and handles prefixed, single-line XML', () => {
    const xml =
      '<?xml version="1.0" ?><sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<sm:url><sm:loc>https://a.test/x?a=1&amp;b=2</sm:loc></sm:url></sm:urlset>';
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      urls: [{ loc: 'https://a.test/x?a=1&b=2' }],
    });
  });

  it('rejects non-sitemaps', () => {
    expect(() => parseSitemap('<html></html>')).toThrow(/Not a sitemap/);
  });
});

describe('robotsSitemaps', () => {
  it("keeps only the robots file's own host", () => {
    const txt = decodeBody(fixture('gymgrossisten-robots.txt'));
    expect(robotsSitemaps(txt, 'https://www.gymgrossisten.com/robots.txt')).toEqual([
      'https://www.gymgrossisten.com/sitemap_index.xml',
    ]);
  });
});
