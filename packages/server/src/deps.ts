/**
 * The matcher, optimizer and shipping rules the server uses by default. The placeholders in
 * matching.ts / optimizing.ts remain available for tests.
 */
import { matchOffers, needsConfirmation } from '@apokorg/matcher';
import { fallbackShippingPolicy, getShippingPolicy, optimize } from '@apokorg/optimizer';
import type { Matcher } from './matching';
import type { Optimizer, ShippingPolicySource } from './optimizing';

export const defaultMatcher: Matcher = { matchOffers, needsConfirmation };
export const defaultOptimizer: Optimizer = { optimize };
export const defaultShippingPolicies: ShippingPolicySource = (ids) =>
  ids.map((id) => getShippingPolicy(id) ?? fallbackShippingPolicy(id));
