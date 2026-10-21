/**
 * Thin typed client for the local server. Requests are validated with the core `api.*`
 * schemas before they are sent, and responses are parsed with them on the way back, so a
 * drifting server shows up as a clear error instead of a broken screen.
 */
import { api, Basket, ShippingPolicy } from '@apokorg/core';
import type { MerchantId } from '@apokorg/core';
import type { z } from 'zod';

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:4517';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<S extends z.ZodType>(
  schema: S | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = api.ApiError.safeParse(json);
    throw new ApiRequestError(res.status, err.success ? err.data.error : `HTTP ${res.status}`);
  }
  return (schema ? schema.parse(json) : undefined) as z.infer<S>;
}

export const client = {
  merchants: () => request(api.MerchantsResponse, 'GET', '/api/merchants'),

  search: (req: z.input<typeof api.SearchRequest>) =>
    request(api.SearchResponse, 'POST', '/api/search', api.SearchRequest.parse(req)),

  productSearch: (req: z.input<typeof api.ProductSearchRequest>) =>
    request(
      api.ProductSearchResponse,
      'POST',
      '/api/products/search',
      api.ProductSearchRequest.parse(req),
    ),

  locate: (req: z.input<typeof api.LocateRequest>) =>
    request(api.SearchResponse, 'POST', '/api/products/locate', api.LocateRequest.parse(req)),

  baskets: () => request(api.BasketsResponse, 'GET', '/api/baskets'),

  basket: (id: string) => request(Basket, 'GET', `/api/baskets/${encodeURIComponent(id)}`),

  putBasket: (id: string, req: z.input<typeof api.PutBasketRequest>) =>
    request(
      Basket,
      'PUT',
      `/api/baskets/${encodeURIComponent(id)}`,
      api.PutBasketRequest.parse(req),
    ),

  deleteBasket: (id: string) => request(null, 'DELETE', `/api/baskets/${encodeURIComponent(id)}`),

  optimize: (id: string, req: z.input<typeof api.OptimizeRequest>) =>
    request(
      api.OptimizeResponse,
      'POST',
      `/api/baskets/${encodeURIComponent(id)}/optimize`,
      api.OptimizeRequest.parse(req),
    ),

  settings: () => request(api.SettingsResponse, 'GET', '/api/settings'),

  putSettings: (settings: z.input<typeof api.SettingsResponse>) =>
    request(api.SettingsResponse, 'PUT', '/api/settings', api.SettingsResponse.parse(settings)),

  /**
   * Not in core's api.ts yet (proposed contract addition):
   * PUT /api/merchants/:id/shipping with a ShippingPolicy body, returns the stored policy.
   */
  putShipping: (merchantId: MerchantId, policy: ShippingPolicy) =>
    request(
      ShippingPolicy,
      'PUT',
      `/api/merchants/${merchantId}/shipping`,
      ShippingPolicy.parse(policy),
    ),
};
