import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { api, Basket, BasketItem } from '@apokorg/core';
import { useSaveBasket } from '../api/hooks';
import { ItemsTable } from '../components/ItemsTable';
import { SavedBaskets } from '../components/SavedBaskets';
import { SearchPanel } from '../components/SearchPanel';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { newId } from '../lib/id';
import { t } from '../strings';

export function BasketPage({
  baskets,
  basket,
  onSelectBasket,
  onCompare,
}: {
  baskets: UseQueryResult<api.BasketsResponse>;
  basket: Basket | undefined;
  onSelectBasket: (id: string | undefined) => void;
  onCompare: () => void;
}) {
  const save = useSaveBasket();
  const [editingItemId, setEditingItemId] = useState<string | undefined>();
  const editing = basket?.items.find((i) => i.id === editingItemId);

  const saveItems = (items: BasketItem[]) => {
    if (basket) {
      save.mutate({ id: basket.id, name: basket.name, items });
    } else {
      const id = newId();
      save.mutate(
        { id, name: t.baskets.defaultName, items },
        { onSuccess: () => onSelectBasket(id) },
      );
    }
  };

  const items = basket?.items ?? [];

  return (
    <div className="grid grid-cols-[16rem_1fr] gap-6">
      <aside>
        <SavedBaskets query={baskets} currentId={basket?.id} onSelect={onSelectBasket} />
      </aside>
      <div className="flex min-w-0 flex-col gap-6">
        {baskets.isLoading && <Spinner />}
        {baskets.error && <ErrorBox error={baskets.error} />}
        <SearchPanel
          key={editing?.id ?? 'new'}
          editing={editing}
          onCancelEdit={() => setEditingItemId(undefined)}
          onAdd={(item) => saveItems([...items, item])}
          onRepin={(itemId, pinned) => {
            saveItems(items.map((i) => (i.id === itemId ? { ...i, pinned } : i)));
            setEditingItemId(undefined);
          }}
        />
        {save.error && <ErrorBox error={save.error} />}
        {basket && (
          <ItemsTable
            items={items}
            onChange={saveItems}
            onChangeMatch={(id) => setEditingItemId(id)}
          />
        )}
        {basket && items.length > 0 && (
          <div>
            <Button variant="primary" onClick={onCompare}>
              {t.nav.split} →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
