import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { api, Basket, MerchantId, ShippingPolicy } from '@apokorg/core';
import type { z } from 'zod';
import { client } from './client';

export const keys = {
  merchants: ['merchants'] as const,
  baskets: ['baskets'] as const,
  settings: ['settings'] as const,
  catalogs: ['catalogs'] as const,
  matchHistory: ['matchHistory'] as const,
  optimize: (basketId: string, req: unknown) => ['optimize', basketId, req] as const,
};

export function useMerchants() {
  return useQuery({ queryKey: keys.merchants, queryFn: client.merchants });
}

export function useBaskets() {
  return useQuery({ queryKey: keys.baskets, queryFn: client.baskets });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: client.settings });
}

/** Polls every 3 s while a catalog refresh is queued or running. */
export function useCatalogStatus() {
  return useQuery({
    queryKey: keys.catalogs,
    queryFn: client.catalogStatus,
    refetchInterval: (q) => (q.state.data?.catalogs.some((c) => c.refreshing) ? 3000 : false),
  });
}

export function useRefreshCatalogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: client.refreshCatalogs,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.catalogs }),
  });
}

export function useFillCart() {
  return useMutation({ mutationFn: client.fillCart });
}

export function useMatchHistory() {
  return useQuery({ queryKey: keys.matchHistory, queryFn: client.matchHistory });
}

export function useSearch() {
  return useMutation({ mutationFn: client.search });
}

export function useProductSearch() {
  return useMutation({ mutationFn: client.productSearch });
}

export function useLocate() {
  return useMutation({ mutationFn: client.locate });
}

export function useSaveBasket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Pick<Basket, 'id' | 'name' | 'items'>) =>
      client.putBasket(b.id, { name: b.name, items: b.items }),
    onSuccess: (saved) => {
      qc.setQueryData<z.infer<typeof api.BasketsResponse>>(keys.baskets, (old) => {
        const list = old?.baskets ?? [];
        const exists = list.some((b) => b.id === saved.id);
        return {
          baskets: exists ? list.map((b) => (b.id === saved.id ? saved : b)) : [...list, saved],
        };
      });
      void qc.invalidateQueries({ queryKey: ['optimize', saved.id] });
      void qc.invalidateQueries({ queryKey: keys.matchHistory });
    },
  });
}

export function useDeleteBasket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: client.deleteBasket,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.baskets }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: client.putSettings,
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      void qc.invalidateQueries({ queryKey: keys.merchants });
      void qc.invalidateQueries({ queryKey: ['optimize'] });
    },
  });
}

export function useSaveShipping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ merchantId, policy }: { merchantId: MerchantId; policy: ShippingPolicy }) =>
      client.putShipping(merchantId, policy),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.merchants });
      void qc.invalidateQueries({ queryKey: ['optimize'] });
    },
  });
}

export function useOptimize(
  basketId: string | undefined,
  req: z.input<typeof api.OptimizeRequest>,
  enabled = true,
) {
  return useQuery({
    queryKey: keys.optimize(basketId ?? '', req),
    queryFn: () => client.optimize(basketId!, req),
    enabled: enabled && !!basketId,
    staleTime: 60_000,
  });
}

/**
 * Runs optimize again with `refresh: true`, so the server searches every store instead of
 * serving its cached offers, and puts the result under `useOptimize(basketId, req)`'s key.
 * The basket's other optimize results are marked stale but not refetched, so a probed split
 * is not probed again behind the user's back.
 */
export function useRefreshOptimize(
  basketId: string | undefined,
  req: z.input<typeof api.OptimizeRequest>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.optimize(basketId!, { ...req, refresh: true }),
    onSuccess: async (data) => {
      const key = keys.optimize(basketId ?? '', req);
      await qc.cancelQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['optimize', basketId], refetchType: 'none' });
      qc.setQueryData(key, data);
    },
  });
}
