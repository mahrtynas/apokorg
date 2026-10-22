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

  it('apotea: one path segment', () => {
    expect(keep('apotea', 'https://www.apotea.se/1541-of-london-pocket-moustache-comb')).toBe(true);
    expect(keep('apotea', 'https://www.apotea.se/braunseries3rakapparat3010bt')).toBe(true);
    expect(keep('apotea', 'https://www.apotea.se/dotarem-inj-vatska-losning-279.3-mg-ml')).toBe(
      true,
    );
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

  it('doz: dozapotek.se slugs ending in a product id', () => {
    const url = 'https://dozapotek.se/alvedon-filmdragerad-tablett-500-mg-20-st-109264';
    expect(keep('doz', url)).toBe(true);
    expect(keep('doz', 'https://dozapotek.se/kopvillkor-pa-dozapotek')).toBe(false);
    expect(keep('doz', 'https://www.doz.se/alvedon-500-mg-20-st-109264')).toBe(false);
    expect(CATALOG_SOURCES.doz.slugToTitle!(new URL(url))).toBe(
      'alvedon filmdragerad tablett 500 mg 20 st',
    );
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

  it('meds: one segment without a trailing slash, no shipping items', () => {
    const url = 'https://www.meds.se/alvedon-filmdragerad-tablett-500-mg-20-st';
    expect(keep('meds', url)).toBe(true);
    expect(keep('meds', 'https://www.meds.se/BABOR-lip-balm-1-styck')).toBe(true);
    expect(keep('meds', 'https://www.meds.se/alvedon/')).toBe(false);
    expect(keep('meds', 'https://www.meds.se/feber-vark/huvudvark/')).toBe(false);
    expect(keep('meds', 'https://www.meds.se/frakt-budbee-hemleverans')).toBe(false);
    expect(
      keep(
        'meds',
        'https://www.meds.se/orifarm-generics-a-s/diazepam-orifarm-10-mg-100-styck-tablett-5711313001589',
      ),
    ).toBe(false);
    expect(keep('meds', 'https://www.meds.se/sok/alvedon')).toBe(false);
    expect(keep('meds', 'https://www.meds.se/')).toBe(false);
    expect(keep('meds', 'https://meds.se/alvedon-filmdragerad-tablett-500-mg-20-st')).toBe(false);
    expect(CATALOG_SOURCES.meds.slugToTitle!(new URL(url))).toBe(
      'alvedon filmdragerad tablett 500 mg 20 st',
    );
    expect(
      CATALOG_SOURCES.meds.slugToTitle!(
        new URL('https://www.meds.se/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560'),
      ),
    ).toBe('inderal 10 mg 100 styck filmdragerad tablett');
  });
});
