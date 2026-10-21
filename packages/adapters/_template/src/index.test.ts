import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProduct, parseSearch } from './index';

const dir = fileURLToPath(new URL('..', import.meta.url));

// Record fixtures first: RECORD_FIXTURES=1 pnpm test:live
describe.skip('__ID__ parsing (enable once fixtures are recorded)', () => {
  it('parses search results into valid offers', async () => {
    const offers = parseSearch(await loadFixture(dir, 'search.json'));
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
  });

  it('parses a product page', async () => {
    const offer = parseProduct(await loadFixture(dir, 'product.html'), '__BASE_URL__/x');
    expect(offer?.price).toBeGreaterThan(0);
  });
});
