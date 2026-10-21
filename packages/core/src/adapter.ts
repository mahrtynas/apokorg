import type { MerchantInfo } from './merchants';
import type { ProductOffer } from './product';
import type { ProbeResult } from './shipping';

export interface SearchOptions {
  /** Maximum number of offers to return. Adapters should default to about 10. */
  limit?: number;
  signal?: AbortSignal;
}

export interface ProbeRequest {
  /** Product URLs plus quantities to put in the cart. */
  items: { url: string; qty: number }[];
  postcode: string;
  email: string;
  signal?: AbortSignal;
}

/**
 * Probe runner provided by packages/checkout-probe. The adapter's probe script gets a
 * guarded page; it never sees the raw browser, so it cannot click forbidden buttons.
 */
export type ProbeFn = (req: ProbeRequest, page: GuardedPage) => Promise<ProbeResult>;

/** Minimal page surface exposed to probe scripts. Implemented by checkout-probe. */
export interface GuardedPage {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  waitFor(selector: string, timeoutMs?: number): Promise<void>;
  evaluateJson<T>(fn: string): Promise<T>;
}

/**
 * One store. Implementations live in packages/adapters/<id> and export
 * `default` as a MerchantAdapter. They must not throw on "no results": return [].
 */
export interface MerchantAdapter {
  info: MerchantInfo;
  /** Free-text search. Returns offers, best first, no matching or filtering applied. */
  search(query: string, opts?: SearchOptions): Promise<ProductOffer[]>;
  /** Re-fetch one product for a live price and stock. */
  getProduct(url: string, opts?: { signal?: AbortSignal }): Promise<ProductOffer | null>;
  /** Present only when the store's checkout test showed guest checkout reveals shipping fees. */
  probe?: ProbeFn;
}
