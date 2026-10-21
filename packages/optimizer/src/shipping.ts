import { ShippingPolicy, type MerchantId } from '@apokorg/core';
import apotea from '../shipping/apotea.json' with { type: 'json' };
import apoteket from '../shipping/apoteket.json' with { type: 'json' };
import doz from '../shipping/doz.json' with { type: 'json' };
import gymgrossisten from '../shipping/gymgrossisten.json' with { type: 'json' };
import hjartat from '../shipping/hjartat.json' with { type: 'json' };
import kronans from '../shipping/kronans.json' with { type: 'json' };
import lyko from '../shipping/lyko.json' with { type: 'json' };
import mock from '../shipping/mock.json' with { type: 'json' };

const RAW: unknown[] = [apotea, hjartat, apoteket, doz, kronans, gymgrossisten, lyko, mock];

/** A rule is stale once it is more than this many days old. */
export const STALE_AFTER_DAYS = 90;

/** All hand-maintained shipping rules from packages/optimizer/shipping/*.json, validated. */
export function loadShippingPolicies(): ShippingPolicy[] {
  return RAW.map((raw) => ShippingPolicy.parse(raw));
}

export function getShippingPolicy(merchantId: MerchantId): ShippingPolicy | undefined {
  return loadShippingPolicies().find((p) => p.merchantId === merchantId);
}

/**
 * Fallback for a merchant without a JSON rule: one home delivery at a conservative fee
 * and never free, so an unknown store is not made to look cheaper than it is.
 */
export function fallbackShippingPolicy(merchantId: MerchantId): ShippingPolicy {
  return {
    merchantId,
    options: [{ id: 'unknown', name: 'Okänd leverans', kind: 'home', fee: 79 }],
    lastVerified: '1970-01-01',
    notes: 'No shipping rule on file; conservative fallback.',
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(d: Date | string): number {
  const date = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS,
  );
}

/** True when the rule was last verified more than 90 days before `today`. */
export function isStale(
  policy: Pick<ShippingPolicy, 'lastVerified'>,
  today: Date | string,
): boolean {
  return toUtcDay(today) - toUtcDay(policy.lastVerified) > STALE_AFTER_DAYS;
}
