import type { api, ProductOffer } from '@apokorg/core';
import { normalizeEan } from '@apokorg/adapter-kit';
import { baseSize, offerFeatures } from './query';

interface Group {
  candidate: api.ProductCandidate;
  /** Best (lowest) position of any of its offers within its store's results. */
  rank: number;
}

/**
 * Identity of an offer without its EAN: brand, name tokens, strength, size and pack count.
 * Two listings of the same product at different stores usually share it even when their
 * titles are worded differently ("filmdragerad tablett" vs "tabletter").
 */
export function titleKey(offer: ProductOffer): string {
  const f = offerFeatures(offer);
  const size = f.size ? baseSize(f.size) : undefined;
  return [
    f.brand ?? '',
    [...new Set(f.tokens)].sort().join(' '),
    f.strength ? `${f.strength.value}${f.strength.unit}` : '',
    size ? `${size.value}${size.unit}` : '',
    f.packCount ?? '',
  ].join('|');
}

/**
 * Groups search results from all stores into distinct products, most relevant first.
 * Offers join a group when they share an EAN, or the same {@link titleKey}. Relevance is the
 * best position any store gave the product, then how many stores carry it.
 */
export function groupProducts(offers: ProductOffer[]): api.ProductCandidate[] {
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  const positionInStore = new Map<string, number>();

  for (const offer of offers) {
    const pos = positionInStore.get(offer.merchantId) ?? 0;
    positionInStore.set(offer.merchantId, pos + 1);

    const ean = normalizeEan(offer.ean);
    const eanKey = ean ? `ean:${ean}` : undefined;
    const tKey = `t:${titleKey(offer)}`;
    let group = (eanKey && byKey.get(eanKey)) || byKey.get(tKey);
    // A title match must not merge two different EANs.
    if (group && ean && group.candidate.ean && group.candidate.ean !== ean) group = undefined;

    if (!group) {
      group = {
        rank: pos,
        candidate: {
          key: eanKey ?? tKey,
          title: offer.title,
          brand: offer.brand,
          ean,
          size: offer.size,
          packCount: offer.packCount,
          imageUrl: offer.imageUrl,
          minPrice: offer.price,
          maxPrice: offer.price,
          merchantIds: [],
          offers: [],
        },
      };
      groups.push(group);
    }

    const c = group.candidate;
    group.rank = Math.min(group.rank, pos);
    c.offers.push(offer);
    if (!c.merchantIds.includes(offer.merchantId)) c.merchantIds.push(offer.merchantId);
    c.minPrice = Math.min(c.minPrice, offer.price);
    c.maxPrice = Math.max(c.maxPrice, offer.price);
    c.ean ??= ean;
    c.brand ??= offer.brand;
    c.imageUrl ??= offer.imageUrl;
    c.size ??= offer.size;
    c.packCount ??= offer.packCount;
    if (eanKey) byKey.set(eanKey, group);
    if (!byKey.has(tKey)) byKey.set(tKey, group);
  }

  return groups
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.candidate.merchantIds.length - a.candidate.merchantIds.length ||
        a.candidate.minPrice - b.candidate.minPrice,
    )
    .map((g) => g.candidate);
}
