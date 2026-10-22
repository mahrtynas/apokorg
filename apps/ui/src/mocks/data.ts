/**
 * In-memory state behind the MSW handlers. Product data comes from @apokorg/adapter-mock;
 * store names, shipping rules and the seed basket are made up for development.
 */
import { MOCK_MERCHANTS } from '@apokorg/adapter-mock';
import type {
  api,
  Basket,
  MerchantCategory,
  MerchantId,
  SearchStrategy,
  Settings,
  ShippingPolicy,
} from '@apokorg/core';

export interface MockMerchant {
  id: MerchantId;
  name: string;
  baseUrl: string;
  category: MerchantCategory;
  searchStrategy: SearchStrategy;
  probeSupported: boolean;
}

const INFO: Partial<Record<MerchantId, Omit<MockMerchant, 'id'>>> = {
  apotea: {
    name: 'Apotea',
    baseUrl: 'https://www.apotea.se',
    category: 'pharmacy',
    searchStrategy: 'catalog-index',
    probeSupported: true,
  },
  hjartat: {
    name: 'Apotek Hjärtat',
    baseUrl: 'https://www.apotekhjartat.se',
    category: 'pharmacy',
    searchStrategy: 'search-page',
    probeSupported: true,
  },
  apoteket: {
    name: 'Apoteket',
    baseUrl: 'https://www.apoteket.se',
    category: 'pharmacy',
    searchStrategy: 'api',
    probeSupported: false,
  },
  doz: {
    name: 'DOZ Apotek',
    baseUrl: 'https://www.doz.se',
    category: 'pharmacy',
    searchStrategy: 'catalog-index',
    probeSupported: true,
  },
  kronans: {
    name: 'Kronans Apotek',
    baseUrl: 'https://www.kronansapotek.se',
    category: 'pharmacy',
    searchStrategy: 'api',
    probeSupported: true,
  },
  gymgrossisten: {
    name: 'Gymgrossisten',
    baseUrl: 'https://www.gymgrossisten.com',
    category: 'sport',
    searchStrategy: 'catalog-index',
    probeSupported: true,
  },
  lyko: {
    name: 'Lyko',
    baseUrl: 'https://lyko.com',
    category: 'beauty',
    searchStrategy: 'search-page',
    probeSupported: false,
  },
};

export const mockMerchants: MockMerchant[] = MOCK_MERCHANTS.map((id) => ({
  id,
  ...(INFO[id] ?? {
    name: id,
    baseUrl: `https://example.com/${id}`,
    category: 'pharmacy' as const,
    searchStrategy: 'api' as const,
    probeSupported: false,
  }),
}));

const policy = (
  merchantId: MerchantId,
  lastVerified: string,
  options: ShippingPolicy['options'],
): ShippingPolicy => ({ merchantId, lastVerified, options, source: 'Made-up mock rule' });

function seedShipping(): ShippingPolicy[] {
  return [
    policy('apotea', '2026-09-30', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 29, freeFrom: 299 },
      { id: 'hem', name: 'Hemleverans', kind: 'home', fee: 69, freeFrom: 599 },
    ]),
    policy('hjartat', '2026-08-15', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 39, freeFrom: 449 },
      { id: 'butik', name: 'Hämta i butik', kind: 'store-pickup', fee: 0, minOrder: 100 },
    ]),
    policy('apoteket', '2026-03-01', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 49, freeFrom: 499 },
      { id: 'hem', name: 'Hemleverans', kind: 'home', fee: 79 },
    ]),
    policy('doz', '2026-10-01', [
      { id: 'brevlada', name: 'Brevlådan', kind: 'mailbox', fee: 19, freeFrom: 249 },
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 39, freeFrom: 249 },
    ]),
    policy('kronans', '2026-09-01', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 45, freeFrom: 399 },
      { id: 'box', name: 'Paketbox', kind: 'parcel-box', fee: 39, freeFrom: 399 },
    ]),
    policy('gymgrossisten', '2026-07-20', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 49, freeFrom: 499 },
      { id: 'hem', name: 'Hemleverans', kind: 'home', fee: 89, freeFrom: 999 },
    ]),
    policy('lyko', '2026-09-10', [
      { id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 39, freeFrom: 349 },
      { id: 'hem', name: 'Hemleverans', kind: 'home', fee: 69, freeFrom: 349 },
    ]),
  ];
}

export interface MockState {
  settings: Settings;
  baskets: Map<string, Basket>;
  shipping: Map<MerchantId, ShippingPolicy>;
  catalogs: Map<MerchantId, api.CatalogStatusResponse['catalogs'][number]>;
}

export const SEED_BASKET_ID = 'seed-basket';

export function createMockState(): MockState {
  const now = new Date().toISOString();
  const seedBasket: Basket = {
    id: SEED_BASKET_ID,
    name: 'Monthly restock',
    updatedAt: now,
    items: [
      { id: 'i1', query: 'alvedon 20 st', qty: 1, acceptSubstitutes: false, pinned: {} },
      {
        id: 'i2',
        query: 'cerave moisturising cream',
        qty: 1,
        acceptSubstitutes: false,
        pinned: {},
      },
      { id: 'i3', query: 'nivea creme', qty: 2, acceptSubstitutes: false, pinned: {} },
      { id: 'i4', query: 'star nutrition whey', qty: 1, acceptSubstitutes: true, pinned: {} },
    ],
  };
  return {
    settings: {
      enabledMerchants: mockMerchants.map((m) => m.id),
      memberOf: [],
      delivery: 'cheapest',
      postcode: '11738',
      probeEnabled: true,
    },
    baskets: new Map([[seedBasket.id, seedBasket]]),
    shipping: new Map(seedShipping().map((p) => [p.merchantId, p])),
    catalogs: new Map(
      (['apotea', 'doz', 'gymgrossisten'] as const).map((merchantId) => [
        merchantId,
        { merchantId, productCount: 0, refreshing: false },
      ]),
    ),
  };
}
