/**
 * Live cart fill against dozapotek.se, never in CI: `pnpm --filter @apokorg/adapter-doz cart:live`.
 * Runs headless in a throwaway profile, so the guest cart is discarded with it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeCartBrowsers, runCartFill } from '@apokorg/checkout-probe';
import { expect, it } from 'vitest';
import adapter from './index';

it('fills the cart with two of one product and opens the checkout', async () => {
  const profileDir = await mkdtemp(join(tmpdir(), 'apokorg-doz-cart-'));
  try {
    const result = await runCartFill(
      adapter,
      {
        items: [
          {
            url: 'https://dozapotek.se/ida-warg-moisture-shampoo-250-ml-779716',
            merchantProductId: '779716',
            qty: 2,
          },
        ],
      },
      { profileDir, headless: true },
    );
    expect(result).toMatchObject({ status: 'ok', url: 'https://dozapotek.se/checkout/' });
  } finally {
    await closeCartBrowsers();
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}, 120_000);
