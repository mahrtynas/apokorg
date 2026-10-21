import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { api, Basket, MerchantId, ShippingPolicy } from '@apokorg/core';
import type { z } from 'zod';
import { client } from './client';

export const keys = {
  merchants: ['merchants'] as const,
  baskets: ['baskets'] as const,
  settings: ['settings'] as const,
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

export function useSearch() {
  return useMutation({ mutationFn: client.search });
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
