export { buildApp, CORS_ORIGINS, type AppOptions } from './app';
export { openDb, openDataDb, defaultDataDir, migrate, MIGRATIONS, type Db } from './db';
export { Repo, queryKey, OFFER_TTL_MS, PROBE_TTL_MS } from './repo';
export { searchStores, searchStore, DEFAULT_SEARCH_TIMEOUT_MS } from './search';
export type { SearchOptions } from './search';
export {
  placeholderMatcher,
  defaultNeedsConfirmation,
  type Matcher,
  type MatchOptions,
} from './matching';
export {
  placeholderOptimizer,
  placeholderShippingPolicies,
  type Optimizer,
  type ShippingPolicySource,
} from './optimizing';
