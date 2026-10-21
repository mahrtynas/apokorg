import { useEffect, useState } from 'react';
import { useBaskets } from './api/hooks';
import { BasketPage } from './pages/BasketPage';
import { ComparisonPage } from './pages/ComparisonPage';
import { SettingsPage } from './pages/SettingsPage';
import { SplitPage } from './pages/SplitPage';
import { t } from './strings';

export type Tab = 'basket' | 'compare' | 'split' | 'settings';
const TABS: Tab[] = ['basket', 'compare', 'split', 'settings'];
const BASKET_KEY = 'apokorg.currentBasket';

function readStored(): string | undefined {
  try {
    return localStorage.getItem(BASKET_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function App({ initialTab = 'basket' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [basketId, setBasketIdState] = useState<string | undefined>(readStored);
  const baskets = useBaskets();

  const setBasketId = (id: string | undefined) => {
    setBasketIdState(id);
    try {
      if (id) localStorage.setItem(BASKET_KEY, id);
      else localStorage.removeItem(BASKET_KEY);
    } catch {
      // Storage is a convenience only.
    }
  };

  // Fall back to the first saved basket when none (or a deleted one) is selected.
  const list = baskets.data?.baskets;
  useEffect(() => {
    if (!list) return;
    if (!basketId || !list.some((b) => b.id === basketId)) {
      setBasketIdState(list[0]?.id);
    }
  }, [list, basketId]);

  const basket = list?.find((b) => b.id === basketId);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <div>
            <div className="text-lg font-semibold text-emerald-800">{t.appName}</div>
            <div className="text-xs text-slate-500">{t.tagline}</div>
          </div>
          <nav aria-label="Main" className="flex gap-1" role="tablist">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === id
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.nav[id]}
              </button>
            ))}
          </nav>
          {basket && tab !== 'settings' && (
            <div className="ml-auto text-sm text-slate-600">
              <span className="font-medium text-slate-900">{basket.name}</span> ·{' '}
              {t.baskets.itemCount(basket.items.length)}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        {tab === 'basket' && (
          <BasketPage
            baskets={baskets}
            basket={basket}
            onSelectBasket={setBasketId}
            onCompare={() => setTab('split')}
          />
        )}
        {tab === 'compare' && <ComparisonPage basket={basket} loading={baskets.isLoading} />}
        {tab === 'split' && <SplitPage basket={basket} loading={baskets.isLoading} />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
