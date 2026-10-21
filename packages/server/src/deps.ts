/**
 * The matcher, optimizer and shipping rules the server uses by default. When packages/matcher
 * and packages/optimizer land, swap the placeholders here, e.g.
 *   export const defaultMatcher: Matcher = { matchOffers };   // from '@apokorg/matcher'
 */
import type { Matcher } from './matching';
import { placeholderMatcher } from './matching';
import type { Optimizer, ShippingPolicySource } from './optimizing';
import { placeholderOptimizer, placeholderShippingPolicies } from './optimizing';

export const defaultMatcher: Matcher = placeholderMatcher;
export const defaultOptimizer: Optimizer = placeholderOptimizer;
export const defaultShippingPolicies: ShippingPolicySource = placeholderShippingPolicies;
