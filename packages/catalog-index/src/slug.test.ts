import { describe, expect, it } from 'vitest';
import { slugToTitle } from './slug';
import { CATALOG_SOURCES } from './stores';

describe('slugToTitle', () => {
  it.each([
    [
      'https://www.apotea.se/alvedon-500-mg-filmdragerad-tablett-20-st',
      'alvedon 500 mg filmdragerad tablett 20 st',
    ],
    [
      'https://www.apotea.se/1541-of-london-dressing-comb-coarsefine-tooth',
      '1541 of london dressing comb coarsefine tooth',
    ],
    [
      'https://www.doz.se/la-roche-posay-effaclar-duo-plus-40-ml',
      'la roche posay effaclar duo plus 40 ml',
    ],
    ['https://www.doz.se/m%C3%B6llers-omega-3-250-ml', 'möllers omega 3 250 ml'],
    // The SKU segment has dashes too; the name segment has more words.
    [
      'https://www.gymgrossisten.com/ua-m-challenger-tracksuit-black/6004052-001R.html',
      'ua m challenger tracksuit black',
    ],
    ['https://www.gymgrossisten.com/kreatin-monohydrat-500-g/609.html', 'kreatin monohydrat 500 g'],
  ])('%s', (url, title) => {
    expect(slugToTitle(url)).toBe(title);
  });

  it('gymgrossisten uses the first segment', () => {
    const { slugToTitle: gym } = CATALOG_SOURCES.gymgrossisten;
    expect(
      gym!(new URL('https://www.gymgrossisten.com/whey-80-vassleprotein-1-kg/SETW80MIX.html')),
    ).toBe('whey 80 vassleprotein 1 kg');
  });
});

describe('store product filters', () => {
  const keep = (id: keyof typeof CATALOG_SOURCES, url: string) =>
    CATALOG_SOURCES[id].productUrlFilter(new URL(url));

  it('apotea: one slug segment', () => {
    expect(keep('apotea', 'https://www.apotea.se/1541-of-london-pocket-moustache-comb')).toBe(true);
    expect(keep('apotea', 'https://www.apotea.se/sok/alvedon')).toBe(false);
    expect(keep('apotea', 'https://www.apotea.se/')).toBe(false);
    expect(
      CATALOG_SOURCES.apotea.sitemapFilter!(
        new URL('https://www.apotea.se/sitemap/files/sitemap-products-2'),
      ),
    ).toBe(true);
    expect(
      CATALOG_SOURCES.apotea.sitemapFilter!(
        new URL('https://www.apotea.se/sitemap/files/sitemap-images-1'),
      ),
    ).toBe(false);
  });

  it('gymgrossisten: /<slug>/<sku>.html only', () => {
    expect(
      keep('gymgrossisten', 'https://www.gymgrossisten.com/kreatin-monohydrat-500-g/609.html'),
    ).toBe(true);
    expect(keep('gymgrossisten', 'https://www.gymgrossisten.com/knaboj.html')).toBe(false);
    expect(keep('gymgrossisten', 'https://www.gymgrossisten.com/allavarumarken/red-bull')).toBe(
      false,
    );
    expect(keep('gymgrossisten', 'https://www.gymgrossisten.no/kreatin-500-g/609.html')).toBe(
      false,
    );
  });
});
