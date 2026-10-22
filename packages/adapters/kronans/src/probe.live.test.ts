/**
 * One live checkout probe against kronansapotek.se. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-kronans probe:live
 * Adds one cheap item, reads the delivery options for postcode 11738 and empties the cart.
 * robots.txt disallows /kassa/; the user approved probing it for personal use (docs/stores/kronans.md).
 */
import { runProbe } from '@apokorg/checkout-probe';
import { expect, it } from 'vitest';
import adapter from './index';

const item =
  process.env.PROBE_ITEM ??
  'https://www.kronansapotek.se/kronans-apotek-tandkram-frisk-mint/p/788053/';

it('probes the live checkout', async () => {
  const result = await runProbe(
    adapter,
    {
      items: [{ url: item, qty: 1 }],
      postcode: process.env.PROBE_POSTCODE ?? '11738',
      email: process.env.PROBE_EMAIL ?? 'm.seskaitis+apokorg@gmail.com',
    },
    { timeoutMs: 120_000 },
  );
  console.log(JSON.stringify(result, null, 2));
  expect(result.status).toBe('ok');
  expect(result.options.length).toBeGreaterThan(0);
}, 150_000);
